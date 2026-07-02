import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isBlobStoreEnabled, loadBlob, saveBlob } from "./blob-store";
import { fetchLeagueMatchDateRange } from "./starrocks";

const BLOB_KEY = "local_store";

export interface TournamentRecord {
  id: number;
  name: string;
  league_id: string;
  event_tier?: TournamentTier;
  // 为 true 时表示标签由用户手动设定，不再被按联赛名自动分类覆盖。
  tier_locked?: boolean;
  // 该联赛在数据库中最早/最晚一场比赛的 start_date（用于首页展示赛段时间）
  match_first_at?: string | null;
  match_last_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRecord {
  id: number;
  tournament_id: number;
  name: string;
  short_name: string | null;
  team_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PlayerRecord {
  id: number;
  team_id: number;
  nickname: string;
  steamid64: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlayerAppearanceCard {
  player_id: number;
  steamid64: string;
  nickname: string;
  position: number;
  tournament_id: number;
  tournament_name: string;
  league_id: string;
  event_tier: TournamentTier;
  team_record_id: number;
  team_name: string;
  team_tag: string | null;
}

interface LocalStoreData {
  tournaments: TournamentRecord[];
  teams: TeamRecord[];
  players: PlayerRecord[];
}

interface CsvRow {
  league_id: string;
  league_name: string;
  team_id: string;
  team_name: string;
  team_tag: string;
  pos1_steamid: string;
  pos2_steamid: string;
  pos3_steamid: string;
  pos4_steamid: string;
  pos5_steamid: string;
  pos1_nickname: string;
  pos2_nickname: string;
  pos3_nickname: string;
  pos4_nickname: string;
  pos5_nickname: string;
}

export type TournamentTier = string;

const TOP_TIER_TOURNAMENTS = new Set([
  "BLAST SLAM VII",
  "DreamLeague Season 29",
  "PGL Wallachia 2026 Season 8",
  "Premier Series",
  "ESL One Birmingham 2026",
  "PGL Wallachia 2026 Season 7",
  "DreamLeague Season 28",
  "BLAST SLAM VI",
  "FISSURE Universe Episode 8",
  "DreamLeague Season 27",
]);

const QUALIFIER_TOURNAMENTS = new Set([
  "Road To EWC 2026 Regional Qualifiers",
  "ESL challenger China powered By ACL",
  "DreamLeague Season 29 Qualifiers",
  "RES Unchained - A Blast Dota Slam VII Qualifier EU",
  "BLAST Slam VII China Qualifier",
  "RES Unchained - A Blast Dota Slam VII Qualifier SEA",
  "ESL challenger China",
  "PGL Wallachia Season #7 AMER Closed Qualifiers",
  "PGL Wallachia Season #7 EEU Closed Qualifiers",
  "PGL Wallachia Season #7 WEU Closed Qualifiers",
  "PGL Wallachia Season #7 Asia Closed Qualifiers",
  "ESL One Birmingham 2026 Qualifiers",
  "DreamLeague Season 28 Qualifiers",
  "RES Unchained - A Blast Dota Slam VI Qualifier EU",
  "BLAST Slam VI China Qualifier",
  "RES Unchained - A Blast Dota Slam VI Qualifier SEA",
]);

const STORE_PATH = path.resolve(process.cwd(), "data", "local-store.json");
const CSV_CANDIDATES = [
  process.env.LOCAL_LINEUP_CSV,
  path.resolve(process.cwd(), "../team_player_info_starting_lineup_with_names_v3.csv"),
  path.resolve(process.cwd(), "../team_player_info_starting_lineup_with_names_v2.csv"),
  path.resolve(process.cwd(), "../team_player_info_starting_lineup_with_names.csv"),
  path.resolve(process.cwd(), "../team_player_info_starting_lineup.csv"),
].filter(Boolean) as string[];

export function isLocalModeEnabled(): boolean {
  return !process.env.COZE_SUPABASE_URL || !process.env.COZE_SUPABASE_ANON_KEY;
}

export function listTournamentSummaries() {
  const db = loadData();
  return db.tournaments
    .map((t) => {
      const teams = db.teams.filter((team) => team.tournament_id === t.id);
      const teamIds = teams.map((team) => team.id);
      const players = db.players.filter((p) => teamIds.includes(p.team_id));
      const totalSlots = teams.length * 5;
      const completion = `${Math.min(players.length, totalSlots)}/${totalSlots}`;
      return {
        id: t.id,
        name: t.name,
        league_id: t.league_id,
        event_tier: t.event_tier ?? classifyTournamentTier(t.name),
        teams_count: teams.length,
        completion,
        match_first_at: t.match_first_at ?? null,
        match_last_at: t.match_last_at ?? null,
        updated_at: t.updated_at,
      };
    })
    .sort((a, b) => {
      const tierCmp = tierOrder(a.event_tier) - tierOrder(b.event_tier);
      if (tierCmp !== 0) return tierCmp;
      return b.updated_at.localeCompare(a.updated_at);
    });
}

export function createTournament(name: string, leagueId: string) {
  const db = loadData();
  const now = new Date().toISOString();
  const record: TournamentRecord = {
    id: nextId(db.tournaments.map((t) => t.id)),
    name,
    league_id: leagueId,
    event_tier: classifyTournamentTier(name),
    created_at: now,
    updated_at: now,
  };
  db.tournaments.push(record);
  saveData(db);
  return record;
}

export function getTournamentById(id: number) {
  return loadData().tournaments.find((t) => t.id === id) ?? null;
}

export function updateTournamentById(
  id: number,
  payload: {
    name?: string;
    league_id?: string;
    event_tier?: TournamentTier;
  }
) {
  const db = loadData();
  const target = db.tournaments.find((t) => t.id === id);
  if (!target) return null;
  if (payload.name !== undefined) target.name = payload.name;
  if (payload.league_id !== undefined) target.league_id = payload.league_id;
  if (payload.event_tier !== undefined) {
    // 手动设定标签：记录并锁定，后续不再被自动分类覆盖。
    target.event_tier = payload.event_tier;
    target.tier_locked = true;
  } else if (!target.tier_locked) {
    // 未锁定时才按（可能变化的）联赛名重新分类。
    target.event_tier = classifyTournamentTier(target.name);
  }
  target.updated_at = new Date().toISOString();
  saveData(db);
  return target;
}

export function deleteTournamentById(id: number) {
  const db = loadData();
  const teamIds = db.teams.filter((t) => t.tournament_id === id).map((t) => t.id);
  db.players = db.players.filter((p) => !teamIds.includes(p.team_id));
  db.teams = db.teams.filter((t) => t.tournament_id !== id);
  const before = db.tournaments.length;
  db.tournaments = db.tournaments.filter((t) => t.id !== id);
  saveData(db);
  return before !== db.tournaments.length;
}

export function listTeamsByTournamentId(tournamentId: number) {
  const db = loadData();
  return db.teams
    .filter((team) => team.tournament_id === tournamentId)
    .map((team) => {
      const players = db.players
        .filter((p) => p.team_id === team.id)
        .sort((a, b) => a.position - b.position);
      const status = computeTeamStatus(players);
      const summary = players.map((p) => `${p.nickname}(${p.position}号位)`).join("、");
      return { ...team, status, summary, players };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createTeamInTournament(
  tournamentId: number,
  payload: { name: string; short_name?: string | null; team_id?: string | null }
) {
  const db = loadData();
  const now = new Date().toISOString();
  const team: TeamRecord = {
    id: nextId(db.teams.map((t) => t.id)),
    tournament_id: tournamentId,
    name: payload.name,
    short_name: payload.short_name ?? null,
    team_id: payload.team_id ?? null,
    status: "缺失",
    created_at: now,
    updated_at: now,
  };
  db.teams.push(team);
  saveData(db);
  return team;
}

export function getTeamById(id: number) {
  return loadData().teams.find((t) => t.id === id) ?? null;
}

export function updateTeamById(
  id: number,
  payload: Partial<Pick<TeamRecord, "name" | "short_name" | "team_id" | "status">>
) {
  const db = loadData();
  const team = db.teams.find((t) => t.id === id);
  if (!team) return null;
  if (payload.name !== undefined) team.name = payload.name;
  if (payload.short_name !== undefined) team.short_name = payload.short_name;
  if (payload.team_id !== undefined) team.team_id = payload.team_id;
  if (payload.status !== undefined) team.status = payload.status;
  team.updated_at = new Date().toISOString();
  saveData(db);
  return team;
}

export function deleteTeamById(id: number) {
  const db = loadData();
  db.players = db.players.filter((p) => p.team_id !== id);
  const before = db.teams.length;
  db.teams = db.teams.filter((t) => t.id !== id);
  saveData(db);
  return before !== db.teams.length;
}

export function listPlayersByTeamId(teamId: number) {
  return loadData().players
    .filter((p) => p.team_id === teamId)
    .sort((a, b) => a.position - b.position);
}

export function addPlayerToTeam(
  teamId: number,
  payload: { nickname: string; steamid64: string | null; position: number }
) {
  const db = loadData();
  const now = new Date().toISOString();
  const player: PlayerRecord = {
    id: nextId(db.players.map((p) => p.id)),
    team_id: teamId,
    nickname: payload.nickname,
    steamid64: payload.steamid64,
    position: payload.position,
    created_at: now,
    updated_at: now,
  };
  db.players.push(player);
  updateTeamStatus(db, teamId);
  saveData(db);
  return player;
}

export function updatePlayerById(
  id: number,
  payload: Partial<Pick<PlayerRecord, "nickname" | "steamid64" | "position">>
) {
  const db = loadData();
  const player = db.players.find((p) => p.id === id);
  if (!player) return null;
  if (payload.nickname !== undefined) player.nickname = payload.nickname;
  if (payload.steamid64 !== undefined) player.steamid64 = payload.steamid64;
  if (payload.position !== undefined) player.position = payload.position;
  player.updated_at = new Date().toISOString();
  updateTeamStatus(db, player.team_id);
  saveData(db);
  return player;
}

export function deletePlayerById(id: number) {
  const db = loadData();
  const target = db.players.find((p) => p.id === id);
  if (!target) return false;
  db.players = db.players.filter((p) => p.id !== id);
  updateTeamStatus(db, target.team_id);
  saveData(db);
  return true;
}

export function findPlayerByTeamAndPosition(teamId: number, position: number) {
  return (
    loadData().players.find((p) => p.team_id === teamId && p.position === position) ??
    null
  );
}

export function exportRows(scope: "all" | "tournament", tournamentId?: number) {
  const db = loadData();
  return exportRowsWithTier(scope, tournamentId, "all");
}

export function exportRowsWithTier(
  scope: "all" | "tournament",
  tournamentId?: number,
  tier: "all" | "top" | "qualifier" = "all"
) {
  const db = loadData();
  let tournaments =
    scope === "tournament" && tournamentId !== undefined
      ? db.tournaments.filter((t) => t.id === tournamentId)
      : db.tournaments.slice();

  if (tier !== "all") {
    tournaments = tournaments.filter((t) => {
      const tournamentTier = t.event_tier ?? classifyTournamentTier(t.name);
      if (tier === "top") return tournamentTier === "顶级赛事";
      return tournamentTier === "预选赛";
    });
  }

  const rows: Array<{
    tournament: TournamentRecord;
    team: TeamRecord;
    player: PlayerRecord | null;
  }> = [];

  for (const tournament of tournaments) {
    const teams = db.teams
      .filter((team) => team.tournament_id === tournament.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const team of teams) {
      const players = db.players
        .filter((p) => p.team_id === team.id)
        .sort((a, b) => a.position - b.position);
      if (players.length === 0) {
        rows.push({ tournament, team, player: null });
      } else {
        for (const player of players) {
          rows.push({ tournament, team, player });
        }
      }
    }
  }
  return rows;
}

export function listPlayerAppearanceCards(): PlayerAppearanceCard[] {
  const db = loadData();
  const tournamentById = new Map(db.tournaments.map((t) => [t.id, t]));
  const teamById = new Map(db.teams.map((t) => [t.id, t]));

  return db.players
    .filter((p) => !!p.steamid64)
    .map((player) => {
      const team = teamById.get(player.team_id);
      const tournament = team ? tournamentById.get(team.tournament_id) : undefined;
      if (!team || !tournament || !player.steamid64) return null;
      return {
        player_id: player.id,
        steamid64: player.steamid64,
        nickname: player.nickname,
        position: player.position,
        tournament_id: tournament.id,
        tournament_name: tournament.name,
        league_id: tournament.league_id,
        event_tier: tournament.event_tier ?? classifyTournamentTier(tournament.name),
        team_record_id: team.id,
        team_name: team.name,
        team_tag: team.short_name,
      } satisfies PlayerAppearanceCard;
    })
    .filter((x): x is PlayerAppearanceCard => x !== null)
    .sort((a, b) => {
      if (a.tournament_id !== b.tournament_id) return b.tournament_id - a.tournament_id;
      const teamCmp = a.team_name.localeCompare(b.team_name);
      if (teamCmp !== 0) return teamCmp;
      return a.position - b.position;
    });
}

export function getPlayerProfileBySteamid64(steamid64: string) {
  const cards = listPlayerAppearanceCards().filter((c) => c.steamid64 === steamid64);
  if (cards.length === 0) return null;
  return {
    steamid64,
    nickname: cards[0].nickname,
    appearances: cards,
  };
}

export function updatePlayerNicknameBySteamid64(
  steamid64: string,
  nickname: string
): { updated_count: number } {
  const db = loadData();
  const now = new Date().toISOString();
  let count = 0;
  for (const player of db.players) {
    if (player.steamid64 === steamid64) {
      player.nickname = nickname;
      player.updated_at = now;
      count += 1;
      updateTeamStatus(db, player.team_id);
    }
  }
  if (count > 0) saveData(db);
  return { updated_count: count };
}

export function movePlayerPositionWithSwap(
  playerId: number,
  targetPosition: number
): {
  moved: boolean;
  swapped_with_player_id?: number;
  team_id?: number;
} {
  const db = loadData();
  const player = db.players.find((p) => p.id === playerId);
  if (!player) return { moved: false };
  if (targetPosition < 1 || targetPosition > 5) return { moved: false };
  if (player.position === targetPosition) return { moved: true, team_id: player.team_id };

  const now = new Date().toISOString();
  const occupied = db.players.find(
    (p) => p.team_id === player.team_id && p.position === targetPosition && p.id !== player.id
  );

  const oldPosition = player.position;
  if (occupied) {
    occupied.position = oldPosition;
    occupied.updated_at = now;
  }

  player.position = targetPosition;
  player.updated_at = now;
  updateTeamStatus(db, player.team_id);
  saveData(db);

  return {
    moved: true,
    swapped_with_player_id: occupied?.id,
    team_id: player.team_id,
  };
}

// ===== 从 StarRocks 比赛明细启发式重建并导入联赛 =====

export interface RawPlayerRow {
  team_name: string | null;
  steamid: string | null;
  name: string | null;
  hits_5m: number | null;
  // 局内分路：1=安全路 2=中路 3=优势路 4=打野
  lane_role?: number | null;
  slot?: number | null;
}

export interface RawTeamRow {
  team_name: string;
  match_count: number;
  team_id?: string | null;
}

export interface MissingPositionTeam {
  team_name: string;
  // 缺少补刀数据、无法判位的选手（昵称或 steamid）
  players_without_hits: string[];
}

export interface LeagueImportResult {
  league_id: string;
  league_name: string;
  tournament_id: number;
  teams_imported: number;
  empty_teams_imported?: number;
  skipped_incomplete_teams: number;
  // 有完整 5 人但缺少补刀数据、无法计算分路的队伍（不编造位置，明确列出缺什么）
  missing_position_teams?: MissingPositionTeam[];
  deduped_teams?: number;
}

interface BuiltPlayer {
  steamid: string;
  nickname: string;
  count: number;
  avgHits: number;
  hasHits: boolean;
  // 主分路（该联赛内众数 lane_role）：1=安全路 2=中路 3=优势路 4=打野；无数据为 null
  laneRole: number | null;
}

interface BuiltTeam {
  team_name: string;
  team_tag: string;
  team_id: string;
  positions: Record<number, BuiltPlayer>;
}

// 返回当前本地库已存在的 league_id 集合
export function getExistingLeagueIds(): Set<string> {
  const db = loadData();
  const teamCountByTournament = new Map<number, number>();
  for (const team of db.teams) {
    teamCountByTournament.set(
      team.tournament_id,
      (teamCountByTournament.get(team.tournament_id) ?? 0) + 1
    );
  }
  // 如果联赛记录存在但没有任何队伍，说明之前可能只是空导入；
  // 联赛库里仍允许再次勾选导入，用 match_overview 队伍兜底补齐。
  return new Set(
    db.tournaments
      .filter((t) => (teamCountByTournament.get(t.id) ?? 0) > 0)
      .map((t) => String(t.league_id))
  );
}

function normalizeTeamName(name: string): string {
  return name.trim().split(/\s+/).join(" ");
}

function isRealExternalTeamId(id: string | null | undefined): boolean {
  const tid = (id ?? "").trim();
  return !!tid && /^\d+$/.test(tid) && tid.length <= 10 && tid !== "0";
}

/** 在同一联赛下查找已有战队：先按队名，再按真实 Dota2 team_id（避免 CSV 全名 vs 概览短名重复导入） */
function findExistingTeamInTournament(
  db: LocalStoreData,
  tournamentId: number,
  teamName: string,
  externalTeamId: string
): TeamRecord | undefined {
  const normalized = normalizeTeamName(teamName);
  const inTour = db.teams.filter((t) => t.tournament_id === tournamentId);

  const byName = inTour.find((t) => normalizeTeamName(t.name) === normalized);
  if (byName) return byName;

  if (isRealExternalTeamId(externalTeamId)) {
    return inTour.find((t) => t.team_id === externalTeamId);
  }
  return undefined;
}

/** 同一联赛内按真实 team_id 去重，保留阵容更完整/队名更短的一条 */
function dedupeTeamsByExternalId(db: LocalStoreData, tournamentId: number): number {
  const inTour = db.teams.filter((t) => t.tournament_id === tournamentId);
  const groups = new Map<string, TeamRecord[]>();
  for (const t of inTour) {
    if (!isRealExternalTeamId(t.team_id)) continue;
    const list = groups.get(t.team_id!) ?? [];
    list.push(t);
    groups.set(t.team_id!, list);
  }
  let removed = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const pa = db.players.filter((p) => p.team_id === a.id).length;
      const pb = db.players.filter((p) => p.team_id === b.id).length;
      if (pb !== pa) return pb - pa;
      return a.name.length - b.name.length;
    });
    for (const dup of group.slice(1)) {
      db.players = db.players.filter((p) => p.team_id !== dup.id);
      db.teams = db.teams.filter((t) => t.id !== dup.id);
      removed += 1;
    }
  }
  return removed;
}

/** 同一联赛内按归一化队名去重（完全同名） */
function dedupeTeamsByNormalizedName(db: LocalStoreData, tournamentId: number): number {
  const inTour = db.teams.filter((t) => t.tournament_id === tournamentId);
  const groups = new Map<string, TeamRecord[]>();
  for (const t of inTour) {
    const key = normalizeTeamName(t.name).toLowerCase();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  let removed = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const pa = db.players.filter((p) => p.team_id === a.id).length;
      const pb = db.players.filter((p) => p.team_id === b.id).length;
      if (pb !== pa) return pb - pa;
      if (isRealExternalTeamId(a.team_id) !== isRealExternalTeamId(b.team_id)) {
        return isRealExternalTeamId(b.team_id) ? 1 : -1;
      }
      return a.id - b.id;
    });
    for (const dup of group.slice(1)) {
      db.players = db.players.filter((p) => p.team_id !== dup.id);
      db.teams = db.teams.filter((t) => t.id !== dup.id);
      removed += 1;
    }
  }
  return removed;
}

/** 对本地库中所有联赛执行战队去重（按真实 team_id + 归一化队名） */
export function dedupeAllTournamentsInStore(): {
  tournaments: number;
  removed: number;
} {
  const db = loadData();
  const tournamentIds = [...new Set(db.teams.map((t) => t.tournament_id))];
  let removed = 0;
  for (const tid of tournamentIds) {
    removed += dedupeTeamsByExternalId(db, tid);
    removed += dedupeTeamsByNormalizedName(db, tid);
  }
  if (removed > 0) saveData(db);
  return { tournaments: tournamentIds.length, removed };
}

function teamTagFromName(name: string): string {
  const normalized = normalizeTeamName(name);
  if (normalized.length <= 8) return normalized;
  const parts = normalized
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .slice(0, 4)
      .map((p) => p[0].toUpperCase())
      .join("")
      .slice(0, 8);
  }
  return normalized.slice(0, 8);
}

function syntheticTeamId(leagueId: string, teamName: string): string {
  const digest = crypto
    .createHash("md5")
    .update(`${leagueId}:${teamName}`)
    .digest("hex")
    .slice(0, 12);
  return BigInt(`0x${digest}`).toString();
}

// 重建阵容：每队取出场最多的 5 人，用「局内分路 lane_role + 5 分钟补刀」精确判位：
//   中路(lane_role=2) → 2 号位；
//   安全路(lane_role=1) 两人：补刀多 = 1 号位，补刀少 = 5 号位；
//   优势路(lane_role=3) 两人：补刀多 = 3 号位，补刀少 = 4 号位。
// 分路取该选手在本届联赛的众数 lane_role。若分路数据不规整（非 2安全/1中/2优势），
// 退化为“按人均补刀从高到低 = 1→5 号位”。slot 只是单场槽位、与分路无关，不参与计算。
// 若某队有 5 人但完全没有补刀数据，则不编造位置，列入 missingPositionTeams。
function buildLineups(
  rows: RawPlayerRow[],
  leagueId: string
): {
  teams: BuiltTeam[];
  skippedIncomplete: number;
  missingPositionTeams: MissingPositionTeam[];
} {
  const stats = new Map<
    string,
    {
      count: number;
      hits: number[];
      names: Map<string, number>;
      laneCounts: Map<number, number>;
    }
  >();
  const teamNameByKey = new Map<string, string>();

  for (const row of rows) {
    const teamName = normalizeTeamName(row.team_name ?? "");
    if (!teamName) continue;
    const sid = (row.steamid ?? "").trim();
    if (!sid) continue;
    const key = `${teamName}\u0000${sid}`;
    teamNameByKey.set(key, teamName);
    const st = stats.get(key) ?? {
      count: 0,
      hits: [] as number[],
      names: new Map<string, number>(),
      laneCounts: new Map<number, number>(),
    };
    st.count += 1;
    if (row.hits_5m != null && !Number.isNaN(row.hits_5m)) st.hits.push(row.hits_5m);
    if (row.lane_role != null && !Number.isNaN(row.lane_role)) {
      st.laneCounts.set(row.lane_role, (st.laneCounts.get(row.lane_role) ?? 0) + 1);
    }
    if (row.name) st.names.set(row.name, (st.names.get(row.name) ?? 0) + 1);
    stats.set(key, st);
  }

  const teamMap = new Map<string, BuiltPlayer[]>();
  for (const [key, st] of stats.entries()) {
    const teamName = teamNameByKey.get(key)!;
    const sid = key.slice(key.indexOf("\u0000") + 1);
    const avgHits = st.hits.length
      ? st.hits.reduce((a, b) => a + b, 0) / st.hits.length
      : 0;
    let bestName = sid;
    let bestNameCount = -1;
    for (const [n, c] of st.names.entries()) {
      if (c > bestNameCount) {
        bestNameCount = c;
        bestName = n;
      }
    }
    let laneRole: number | null = null;
    let laneBest = -1;
    for (const [lane, c] of st.laneCounts.entries()) {
      if (c > laneBest) {
        laneBest = c;
        laneRole = lane;
      }
    }
    const list = teamMap.get(teamName) ?? [];
    list.push({
      steamid: sid,
      nickname: bestName,
      count: st.count,
      avgHits,
      hasHits: st.hits.length > 0,
      laneRole,
    });
    teamMap.set(teamName, list);
  }

  const teams: BuiltTeam[] = [];
  let skippedIncomplete = 0;
  const missingPositionTeams: MissingPositionTeam[] = [];

  for (const [teamName, players] of teamMap.entries()) {
    const top5 = players
      .slice()
      .sort((a, b) => b.count - a.count || b.avgHits - a.avgHits)
      .slice(0, 5);
    if (top5.length < 5) {
      skippedIncomplete += 1;
      continue;
    }

    // 完全没有补刀数据则无法判位，不编造。
    const withoutHits = top5.filter((p) => !p.hasHits);
    if (withoutHits.length > 0) {
      missingPositionTeams.push({
        team_name: teamName,
        players_without_hits: withoutHits.map((p) => p.nickname),
      });
      continue;
    }

    const assigned = assignPositions(top5);
    teams.push({
      team_name: teamName,
      team_tag: teamTagFromName(teamName),
      team_id: syntheticTeamId(leagueId, teamName),
      positions: assigned,
    });
  }

  teams.sort((a, b) => a.team_name.localeCompare(b.team_name));
  return { teams, skippedIncomplete, missingPositionTeams };
}

// 用局内分路 + 5 分钟补刀给 5 名选手分配 1~5 号位。
function assignPositions(top5: BuiltPlayer[]): Record<number, BuiltPlayer> {
  const safe = top5.filter((p) => p.laneRole === 1);
  const mid = top5.filter((p) => p.laneRole === 2);
  const off = top5.filter((p) => p.laneRole === 3);

  // 标准阵型：安全路 2 人、中路 1 人、优势路 2 人 → 用补刀区分核心/辅助。
  if (safe.length === 2 && mid.length === 1 && off.length === 2) {
    const safeSorted = safe.slice().sort((a, b) => b.avgHits - a.avgHits);
    const offSorted = off.slice().sort((a, b) => b.avgHits - a.avgHits);
    return {
      1: safeSorted[0], // 安全路核心
      2: mid[0], // 中路
      3: offSorted[0], // 优势路核心
      4: offSorted[1], // 优势路辅助
      5: safeSorted[1], // 安全路辅助
    };
  }

  // 分路数据不规整（游走/打野/缺失等）时退化为纯补刀排序：补刀多→1，少→5。
  const ranked = top5.slice().sort((a, b) => b.avgHits - a.avgHits);
  const assigned: Record<number, BuiltPlayer> = {};
  [1, 2, 3, 4, 5].forEach((pos, idx) => {
    assigned[pos] = ranked[idx];
  });
  return assigned;
}

// 将重建出的联赛阵容合并进本地库（按 league_id 去重，按 战队名 去重并整队替换选手）
export function importLeagueFromRawRows(
  leagueId: string,
  leagueName: string,
  rows: RawPlayerRow[],
  fallbackTeams: RawTeamRow[] = [],
  matchDates?: { first_at: string | null; last_at: string | null } | null
): LeagueImportResult {
  const db = loadData();
  const now = new Date().toISOString();
  const { teams: builtTeams, skippedIncomplete, missingPositionTeams } =
    buildLineups(rows, leagueId);

  const externalIdByName = new Map<string, string>();
  for (const t of fallbackTeams) {
    const name = normalizeTeamName(t.team_name);
    const tid = (t.team_id ?? "").trim();
    if (name && tid && /^\d+$/.test(tid)) externalIdByName.set(name, tid);
  }
  const resolveTeamExternalId = (teamName: string) =>
    externalIdByName.get(normalizeTeamName(teamName)) ??
    syntheticTeamId(leagueId, teamName);

  let tournament = db.tournaments.find((t) => String(t.league_id) === String(leagueId));
  if (!tournament) {
    tournament = {
      id: nextId(db.tournaments.map((t) => t.id)),
      name: leagueName,
      league_id: String(leagueId),
      event_tier: classifyTournamentTier(leagueName),
      created_at: now,
      updated_at: now,
    };
    db.tournaments.push(tournament);
  } else {
    tournament.name = leagueName;
    if (!tournament.tier_locked) {
      tournament.event_tier = classifyTournamentTier(leagueName);
    }
    tournament.updated_at = now;
  }
  if (matchDates?.first_at) tournament.match_first_at = matchDates.first_at;
  if (matchDates?.last_at) tournament.match_last_at = matchDates.last_at;

  const builtTeamNames = new Set(builtTeams.map((bt) => normalizeTeamName(bt.team_name)));

  // 缺少补刀数据、无法判位的队伍：建成“缺失”状态占位，不写入编造的位置。
  for (const mt of missingPositionTeams) {
    const teamName = normalizeTeamName(mt.team_name);
    if (!teamName) continue;
    builtTeamNames.add(teamName);
    const extId = resolveTeamExternalId(teamName);
    let team = findExistingTeamInTournament(db, tournament!.id, teamName, extId);
    if (!team) {
      team = {
        id: nextId(db.teams.map((t) => t.id)),
        tournament_id: tournament.id,
        name: teamName,
        short_name: teamTagFromName(teamName) || null,
        team_id: extId,
        status: "缺失",
        created_at: now,
        updated_at: now,
      };
      db.teams.push(team);
    } else {
      team.name = teamName;
      team.team_id = extId;
      team.status = "缺失";
      team.updated_at = now;
    }
    // 清掉旧的（可能是之前 slot 编造出来的）位置，避免残留错误数据。
    db.players = db.players.filter((p) => p.team_id !== team!.id);
  }

  for (const bt of builtTeams) {
    const extId = resolveTeamExternalId(bt.team_name);
    let team = findExistingTeamInTournament(db, tournament!.id, bt.team_name, extId);
    if (!team) {
      team = {
        id: nextId(db.teams.map((t) => t.id)),
        tournament_id: tournament.id,
        name: bt.team_name,
        short_name: bt.team_tag || null,
        team_id: extId,
        status: "完整",
        created_at: now,
        updated_at: now,
      };
      db.teams.push(team);
    } else {
      team.name = bt.team_name;
      team.short_name = bt.team_tag || null;
      team.team_id = extId;
      team.status = "完整";
      team.updated_at = now;
    }

    db.players = db.players.filter((p) => p.team_id !== team!.id);
    for (const pos of [1, 2, 3, 4, 5]) {
      const p = bt.positions[pos];
      db.players.push({
        id: nextId(db.players.map((x) => x.id)),
        team_id: team.id,
        nickname: p.nickname,
        steamid64: p.steamid,
        position: pos,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // 如果 player_positions 没有明细，仍用 match_overview 的队伍名创建空阵容队伍。
  // 这样导入后战队阵容管理器能先看到队伍，再手工补选手/等待后续数据补齐。
  let emptyTeamsImported = 0;
  for (const rawTeam of fallbackTeams) {
    const teamName = normalizeTeamName(rawTeam.team_name);
    if (!teamName || builtTeamNames.has(teamName)) continue;
    const extId = resolveTeamExternalId(teamName);
    const existing = findExistingTeamInTournament(db, tournament!.id, teamName, extId);
    if (existing) continue;
    db.teams.push({
      id: nextId(db.teams.map((t) => t.id)),
      tournament_id: tournament.id,
      name: teamName,
      short_name: teamTagFromName(teamName) || null,
      team_id: resolveTeamExternalId(teamName),
      status: "缺失",
      created_at: now,
      updated_at: now,
    });
    emptyTeamsImported += 1;
  }

  const dedupedTeams =
    dedupeTeamsByExternalId(db, tournament.id) +
    dedupeTeamsByNormalizedName(db, tournament.id);

  saveData(db);
  return {
    league_id: String(leagueId),
    league_name: leagueName,
    tournament_id: tournament.id,
    teams_imported: builtTeams.length + emptyTeamsImported,
    empty_teams_imported: emptyTeamsImported,
    skipped_incomplete_teams: skippedIncomplete,
    missing_position_teams: missingPositionTeams,
    deduped_teams: dedupedTeams,
  };
}

function updateTeamStatus(db: LocalStoreData, teamId: number) {
  const team = db.teams.find((t) => t.id === teamId);
  if (!team) return;
  const players = db.players.filter((p) => p.team_id === teamId);
  team.status = computeTeamStatus(players);
  team.updated_at = new Date().toISOString();
}

function computeTeamStatus(players: PlayerRecord[]) {
  const positions = players.map((p) => p.position);
  const unique = new Set(positions);
  if (players.length === 5 && unique.size === 5) return "完整";
  if (unique.size < players.length) return "重复";
  if (players.length > 0) return "待确认";
  return "缺失";
}

function loadData(): LocalStoreData {
  ensureInitialized();
  const raw = fs.readFileSync(STORE_PATH, "utf-8");
  const data = JSON.parse(raw) as LocalStoreData;
  if (
    data.tournaments.length === 1 &&
    data.tournaments[0]?.league_id === "" &&
    CSV_CANDIDATES.some((p) => fs.existsSync(p))
  ) {
    const candidate = CSV_CANDIDATES.find((p) => fs.existsSync(p));
    if (candidate) {
      const rebuilt = bootstrapFromCsv(candidate);
      saveData(rebuilt);
      return rebuilt;
    }
  }
  let migrated = false;
  for (const tournament of data.tournaments) {
    // 用户手动锁定过标签的联赛不再自动重判。
    if (tournament.tier_locked) continue;
    const expected = classifyTournamentTier(tournament.name);
    if (tournament.event_tier !== expected) {
      tournament.event_tier = expected;
      migrated = true;
    }
  }
  if (migrated) {
    saveData(data);
  }
  return data;
}

function saveData(data: LocalStoreData) {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  schedulePush(data);
}

// 写操作后把整份状态回写到远端 blob（防抖，避免高频写放大）。
let pushTimer: NodeJS.Timeout | null = null;
let pendingPush: LocalStoreData | null = null;
function schedulePush(data: LocalStoreData) {
  if (!isBlobStoreEnabled()) return;
  pendingPush = data;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const snapshot = pendingPush;
    pushTimer = null;
    pendingPush = null;
    if (snapshot) void saveBlob(BLOB_KEY, snapshot);
  }, 400);
}

// 为缺少赛段时间的联赛从 StarRocks 补全 match_first_at / match_last_at
export async function enrichTournamentMatchDates(): Promise<number> {
  const db = loadData();
  let updated = 0;
  for (const t of db.tournaments) {
    const leagueId = String(t.league_id ?? "").trim();
    if (!leagueId || leagueId === "0") continue;
    if (t.match_first_at && t.match_last_at) continue;
    try {
      const range = await fetchLeagueMatchDateRange(leagueId);
      if (!range.first_at && !range.last_at) continue;
      t.match_first_at = range.first_at;
      t.match_last_at = range.last_at;
      updated += 1;
    } catch {
      // 单联赛查询失败不影响其余
    }
  }
  if (updated > 0) saveData(db);
  return updated;
}

// 启动时从远端 blob 拉取并落到本地文件；远端为空则用本地（种子）数据初始化远端。
let hydrated = false;
export async function hydrateLocalStore(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!isBlobStoreEnabled()) return;
  try {
    const remote = await loadBlob<LocalStoreData>(BLOB_KEY);
    if (remote && Array.isArray(remote.tournaments)) {
      ensureDataDir();
      fs.writeFileSync(STORE_PATH, JSON.stringify(remote, null, 2), "utf-8");
      console.log("[local-store] 已从远端 blob 恢复数据");
      const dedupe = dedupeAllTournamentsInStore();
      if (dedupe.removed > 0) {
        console.log(
          `[local-store] 启动全库去重: ${dedupe.tournaments} 个联赛, 移除 ${dedupe.removed} 条重复战队`
        );
      }
    } else {
      ensureInitialized();
      const seed = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as LocalStoreData;
      await saveBlob(BLOB_KEY, seed);
      console.log("[local-store] 远端为空，已用本地种子数据初始化远端 blob");
    }
  } catch (e) {
    console.error("[local-store] hydrate 失败，回退本地文件:", e);
  }
}

function ensureInitialized() {
  if (fs.existsSync(STORE_PATH)) return;
  ensureDataDir();
  const candidate = CSV_CANDIDATES.find((p) => fs.existsSync(p));
  if (!candidate) {
    saveData({ tournaments: [], teams: [], players: [] });
    return;
  }
  const data = bootstrapFromCsv(candidate);
  saveData(data);
}

function bootstrapFromCsv(csvPath: string): LocalStoreData {
  const text = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCsv(text);
  const now = new Date().toISOString();
  const tournaments: TournamentRecord[] = [];
  const teams: TeamRecord[] = [];
  const players: PlayerRecord[] = [];
  const leagueToTournamentId = new Map<string, number>();
  let tournamentSeq = 1;
  let teamSeq = 1;
  let playerSeq = 1;

  for (const row of rows) {
    const leagueKey = row.league_id;
    if (!leagueToTournamentId.has(leagueKey)) {
      leagueToTournamentId.set(leagueKey, tournamentSeq);
      tournaments.push({
        id: tournamentSeq,
        name: row.league_name,
        league_id: row.league_id,
        event_tier: classifyTournamentTier(row.league_name),
        created_at: now,
        updated_at: now,
      });
      tournamentSeq += 1;
    }
    const tournamentId = leagueToTournamentId.get(leagueKey)!;
    const team = {
      id: teamSeq,
      tournament_id: tournamentId,
      name: row.team_name,
      short_name: row.team_tag || null,
      team_id: row.team_id || null,
      status: "完整",
      created_at: now,
      updated_at: now,
    };
    teams.push(team);
    const positions = [1, 2, 3, 4, 5] as const;
    for (const pos of positions) {
      const nickname = row[`pos${pos}_nickname` as keyof CsvRow] as string;
      const steamid = row[`pos${pos}_steamid` as keyof CsvRow] as string;
      players.push({
        id: playerSeq,
        team_id: team.id,
        nickname,
        steamid64: steamid || null,
        position: pos,
        created_at: now,
        updated_at: now,
      });
      playerSeq += 1;
    }
    teamSeq += 1;
  }

  return { tournaments, teams, players };
}

function parseCsv(content: string): CsvRow[] {
  const lines = parseCsvRows(content);
  if (lines.length === 0) return [];
  const headers = lines[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  return lines
    .slice(1)
    .filter((record) => record.some((v) => v.trim() !== ""))
    .map((record) => {
      const obj = Object.fromEntries(
        headers.map((h, index) => [h, record[index] ?? ""])
      ) as Record<string, string>;
      return {
        league_id: obj.league_id ?? "",
        league_name: obj.league_name ?? "",
        team_id: obj.team_id ?? "",
        team_name: obj.team_name ?? "",
        team_tag: obj.team_tag ?? "",
        pos1_steamid: obj.pos1_steamid ?? "",
        pos2_steamid: obj.pos2_steamid ?? "",
        pos3_steamid: obj.pos3_steamid ?? "",
        pos4_steamid: obj.pos4_steamid ?? "",
        pos5_steamid: obj.pos5_steamid ?? "",
        pos1_nickname: obj.pos1_nickname ?? "",
        pos2_nickname: obj.pos2_nickname ?? "",
        pos3_nickname: obj.pos3_nickname ?? "",
        pos4_nickname: obj.pos4_nickname ?? "",
        pos5_nickname: obj.pos5_nickname ?? "",
      };
    });
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function nextId(ids: number[]) {
  if (ids.length === 0) return 1;
  return Math.max(...ids) + 1;
}

function ensureDataDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function classifyTournamentTier(name: string): TournamentTier {
  if (TOP_TIER_TOURNAMENTS.has(name)) return "顶级赛事";
  if (QUALIFIER_TOURNAMENTS.has(name)) return "预选赛";
  if (/qualifier/i.test(name)) return "预选赛";
  return "其他";
}

function tierOrder(tier: TournamentTier) {
  if (tier === "顶级赛事") return 0;
  if (tier === "预选赛") return 1;
  if (tier === "其他") return 2;
  return 3;
}
