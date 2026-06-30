import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isBlobStoreEnabled, loadBlob, saveBlob } from "./blob-store";

const BLOB_KEY = "local_store";

export interface TournamentRecord {
  id: number;
  name: string;
  league_id: string;
  event_tier?: TournamentTier;
  // 为 true 时表示标签由用户手动设定，不再被按联赛名自动分类覆盖。
  tier_locked?: boolean;
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

export type TournamentTier = "顶级赛事" | "预选赛" | "其他";

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
}

export interface LeagueImportResult {
  league_id: string;
  league_name: string;
  tournament_id: number;
  teams_imported: number;
  skipped_incomplete_teams: number;
}

interface BuiltPlayer {
  steamid: string;
  nickname: string;
  count: number;
  avgHits: number;
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
  return new Set(db.tournaments.map((t) => String(t.league_id)));
}

// 基于已有数据，统计每个 steamid 最常见的位置，作为重建时的分路提示
function buildPositionHints(db: LocalStoreData): Map<string, number> {
  const bySid = new Map<string, Map<number, number>>();
  for (const p of db.players) {
    if (!p.steamid64 || !p.position) continue;
    const counts = bySid.get(p.steamid64) ?? new Map<number, number>();
    counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
    bySid.set(p.steamid64, counts);
  }
  const hints = new Map<string, number>();
  for (const [sid, counts] of bySid.entries()) {
    let bestPos = 0;
    let bestCount = -1;
    for (const [pos, c] of counts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestPos = pos;
      }
    }
    if (bestPos) hints.set(sid, bestPos);
  }
  return hints;
}

function normalizeTeamName(name: string): string {
  return name.trim().split(/\s+/).join(" ");
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

// 启发式重建：每队取出场最多的 5 人，先按分路提示分配，剩余按补刀均值排序填入空位
function buildLineups(
  rows: RawPlayerRow[],
  positionHints: Map<string, number>,
  leagueId: string
): { teams: BuiltTeam[]; skippedIncomplete: number } {
  const stats = new Map<
    string,
    { count: number; hits: number[]; names: Map<string, number> }
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
    };
    st.count += 1;
    if (row.hits_5m != null && !Number.isNaN(row.hits_5m)) st.hits.push(row.hits_5m);
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
    const list = teamMap.get(teamName) ?? [];
    list.push({ steamid: sid, nickname: bestName, count: st.count, avgHits });
    teamMap.set(teamName, list);
  }

  const teams: BuiltTeam[] = [];
  let skippedIncomplete = 0;

  for (const [teamName, players] of teamMap.entries()) {
    const top5 = players
      .slice()
      .sort((a, b) => b.count - a.count || b.avgHits - a.avgHits)
      .slice(0, 5);
    if (top5.length < 5) {
      skippedIncomplete += 1;
      continue;
    }

    const assigned: Record<number, BuiltPlayer> = {};
    const usedPositions = new Set<number>();

    for (const p of top5) {
      const hint = positionHints.get(p.steamid);
      if (hint && !usedPositions.has(hint)) {
        assigned[hint] = p;
        usedPositions.add(hint);
      }
    }

    const remainingPlayers = top5
      .filter((p) => !Object.values(assigned).includes(p))
      .sort((a, b) => b.avgHits - a.avgHits);
    const remainingPositions = [1, 2, 3, 4, 5].filter((pos) => !usedPositions.has(pos));
    remainingPositions.forEach((pos, idx) => {
      if (remainingPlayers[idx]) assigned[pos] = remainingPlayers[idx];
    });

    if ([1, 2, 3, 4, 5].some((pos) => !assigned[pos])) {
      skippedIncomplete += 1;
      continue;
    }

    teams.push({
      team_name: teamName,
      team_tag: teamTagFromName(teamName),
      team_id: syntheticTeamId(leagueId, teamName),
      positions: assigned,
    });
  }

  teams.sort((a, b) => a.team_name.localeCompare(b.team_name));
  return { teams, skippedIncomplete };
}

// 将重建出的联赛阵容合并进本地库（按 league_id 去重，按 战队名 去重并整队替换选手）
export function importLeagueFromRawRows(
  leagueId: string,
  leagueName: string,
  rows: RawPlayerRow[]
): LeagueImportResult {
  const db = loadData();
  const now = new Date().toISOString();
  const positionHints = buildPositionHints(db);
  const { teams: builtTeams, skippedIncomplete } = buildLineups(
    rows,
    positionHints,
    leagueId
  );

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
    tournament.event_tier = classifyTournamentTier(leagueName);
    tournament.updated_at = now;
  }

  for (const bt of builtTeams) {
    let team = db.teams.find(
      (t) => t.tournament_id === tournament!.id && t.name === bt.team_name
    );
    if (!team) {
      team = {
        id: nextId(db.teams.map((t) => t.id)),
        tournament_id: tournament.id,
        name: bt.team_name,
        short_name: bt.team_tag || null,
        team_id: bt.team_id,
        status: "完整",
        created_at: now,
        updated_at: now,
      };
      db.teams.push(team);
    } else {
      team.short_name = bt.team_tag || null;
      team.team_id = bt.team_id;
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

  saveData(db);
  return {
    league_id: String(leagueId),
    league_name: leagueName,
    tournament_id: tournament.id,
    teams_imported: builtTeams.length,
    skipped_incomplete_teams: skippedIncomplete,
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
  return 2;
}
