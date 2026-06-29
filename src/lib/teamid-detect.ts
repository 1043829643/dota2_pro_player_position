import mysql from "mysql2/promise";

// 同阵容多 team_id 检测：数据源为 StarRocks 的 dota2_analysis 库。
// 由 Python 工具(detect_same_roster_team_ids.py)移植而来，逻辑保持一致。
const ANALYSIS_CONFIG = {
  host: process.env.STARROCKS_HOST ?? "47.86.96.51",
  port: Number(process.env.STARROCKS_PORT ?? 9030),
  user: process.env.STARROCKS_USER ?? "dota2_reader",
  password: process.env.STARROCKS_PASSWORD ?? "readerDota.",
  database: process.env.STARROCKS_ANALYSIS_DB ?? "dota2_analysis",
};

const SCHEMA = "`" + ANALYSIS_CONFIG.database + "`";

export type DetectionMode = "same_league" | "cross_league";

export interface DetectOptions {
  mode: DetectionMode;
  maxDiff: 0 | 1 | 2;
  leagueId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  limit?: number | null;
}

export interface AnomalyRow {
  league_id: string;
  league_name: string;
  roster_key: string;
  roster_players: string;
  league_count: number;
  team_id_count: number;
  roster_occurrences: number;
  team_ids: string;
  team_id_names: string;
  match_ids: string;
  first_seen: number | string;
  last_seen: number | string;
}

async function withConnection<T>(
  fn: (conn: mysql.Connection) => Promise<T>
): Promise<T> {
  const conn = await mysql.createConnection({
    ...ANALYSIS_CONFIG,
    connectTimeout: 15000,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

// 解析时间过滤：支持 yyyy-mm-dd 或 unix 秒
function parseTimeFilter(value: string | null | undefined, endOfDay = false): number | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const d = new Date(trimmed + (endOfDay ? "T23:59:59" : "T00:00:00"));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

// 构建共享过滤条件与参数（顺序：时间过滤在前，联赛过滤在后）
function analysisFilters(opts: DetectOptions): {
  matchFilters: string[];
  filters: string[];
  params: Array<string | number>;
} {
  const filters = ["mi.league_id IS NOT NULL"];
  const matchFilters = [
    "match_id IS NOT NULL",
    "CAST(match_id AS VARCHAR) <> '0'",
    "league_id IS NOT NULL",
  ];
  const params: Array<string | number> = [];

  const startTime = parseTimeFilter(opts.startTime);
  const endTime = parseTimeFilter(opts.endTime, true);
  if (startTime !== null) {
    matchFilters.push("end_time >= ?");
    params.push(startTime);
  }
  if (endTime !== null) {
    matchFilters.push("end_time <= ?");
    params.push(endTime);
  }
  if (opts.leagueId) {
    filters.push("mi.league_id = ?");
    params.push(opts.leagueId);
  }
  return { matchFilters, filters, params };
}

function buildAnalysisCtes(matchFilters: string[], filters: string[]): string {
  return `league_names AS (
      SELECT CAST(league_id AS VARCHAR) AS league_id, MAX(league_name) AS league_name
      FROM (
        SELECT league_id, league_name FROM ${SCHEMA}.\`pro_match_list\`
        UNION ALL
        SELECT league_id, league_name FROM ${SCHEMA}.\`pro_match_list_2\`
        UNION ALL
        SELECT league_id, league_name FROM ${SCHEMA}.\`match_info_upload\`
      ) names
      WHERE league_id IS NOT NULL AND league_name IS NOT NULL AND league_name <> ''
      GROUP BY CAST(league_id AS VARCHAR)
    ),
    pro_players_dedup AS (
      SELECT CAST(steamid AS VARCHAR) AS steamid, MAX(name) AS player_name
      FROM ${SCHEMA}.\`pro_players\`
      WHERE steamid IS NOT NULL
      GROUP BY CAST(steamid AS VARCHAR)
    ),
    match_info_dedup AS (
      SELECT
        CAST(match_id AS VARCHAR) AS match_id,
        CAST(MAX(league_id) AS VARCHAR) AS league_id,
        CAST(MAX(radiant_team_id) AS VARCHAR) AS radiant_team_id,
        CAST(MAX(dire_team_id) AS VARCHAR) AS dire_team_id,
        MAX(radiant_team_tag) AS radiant_team_name,
        MAX(dire_team_tag) AS dire_team_name,
        MIN(end_time) AS first_seen,
        MAX(end_time) AS last_seen
      FROM ${SCHEMA}.\`match_info\`
      WHERE ${matchFilters.join(" AND ")}
      GROUP BY CAST(match_id AS VARCHAR)
    ),
    player_rows AS (
      SELECT
        mi.league_id,
        mi.match_id,
        CASE
          WHEN p.team = 2 THEN mi.radiant_team_id
          WHEN p.team = 3 THEN mi.dire_team_id
          WHEN p.slot BETWEEN 0 AND 4 THEN mi.radiant_team_id
          WHEN p.slot BETWEEN 5 AND 9 THEN mi.dire_team_id
        END AS team_id,
        CASE
          WHEN p.team = 2 THEN mi.radiant_team_name
          WHEN p.team = 3 THEN mi.dire_team_name
          WHEN p.slot BETWEEN 0 AND 4 THEN mi.radiant_team_name
          WHEN p.slot BETWEEN 5 AND 9 THEN mi.dire_team_name
        END AS team_name,
        CAST(p.steamid AS VARCHAR) AS player_id,
        pp.player_name,
        mi.first_seen,
        mi.last_seen
      FROM ${SCHEMA}.\`players\` p
      JOIN match_info_dedup mi ON CAST(p.match_id AS VARCHAR) = mi.match_id
      LEFT JOIN pro_players_dedup pp ON CAST(p.steamid AS VARCHAR) = pp.steamid
      WHERE p.steamid IS NOT NULL
        AND CAST(p.match_id AS VARCHAR) <> '0'
        AND ${filters.join(" AND ")}
    ),
    team_rosters AS (
      SELECT
        league_id,
        match_id,
        CAST(team_id AS VARCHAR) AS team_id,
        MAX(team_name) AS team_name,
        COUNT(DISTINCT player_id) AS player_count,
        GROUP_CONCAT(DISTINCT player_id ORDER BY player_id SEPARATOR ',') AS roster_key,
        GROUP_CONCAT(DISTINCT CONCAT(player_id, ' | ', COALESCE(player_name, '')) ORDER BY player_id SEPARATOR ';;') AS roster_players,
        MIN(first_seen) AS first_seen,
        MAX(last_seen) AS last_seen
      FROM player_rows
      WHERE team_id IS NOT NULL AND CAST(team_id AS VARCHAR) <> '0'
      GROUP BY league_id, match_id, CAST(team_id AS VARCHAR)
      HAVING COUNT(DISTINCT player_id) = 5
    )`;
}

function buildExactDetectionSql(opts: DetectOptions): {
  sql: string;
  params: Array<string | number>;
} {
  const { matchFilters, filters, params } = analysisFilters(opts);
  const limitClause = opts.limit ? " LIMIT ?" : "";

  const anomalySql =
    opts.mode === "cross_league"
      ? `anomalies AS (
          SELECT
            GROUP_CONCAT(DISTINCT tr.league_id ORDER BY tr.league_id SEPARATOR ',') AS league_id,
            GROUP_CONCAT(DISTINCT CONCAT(tr.league_id, ' | ', COALESCE(ln.league_name, '')) ORDER BY tr.league_id SEPARATOR ';;') AS league_name,
            tr.roster_key,
            MAX(tr.roster_players) AS roster_players,
            COUNT(DISTINCT tr.league_id) AS league_count,
            COUNT(DISTINCT team_id) AS team_id_count,
            COUNT(*) AS roster_occurrences,
            GROUP_CONCAT(DISTINCT team_id ORDER BY team_id SEPARATOR ',') AS team_ids,
            GROUP_CONCAT(DISTINCT CONCAT(team_id, ' | ', COALESCE(team_name, '')) ORDER BY team_id SEPARATOR ';;') AS team_id_names,
            GROUP_CONCAT(DISTINCT match_id ORDER BY match_id SEPARATOR ',') AS match_ids,
            MIN(first_seen) AS first_seen,
            MAX(last_seen) AS last_seen
          FROM team_rosters tr
          LEFT JOIN league_names ln ON tr.league_id = ln.league_id
          GROUP BY tr.roster_key
          HAVING COUNT(DISTINCT tr.league_id) > 1 AND COUNT(DISTINCT team_id) > 1
        )`
      : `anomalies AS (
          SELECT
            tr.league_id,
            MAX(ln.league_name) AS league_name,
            tr.roster_key,
            MAX(tr.roster_players) AS roster_players,
            1 AS league_count,
            COUNT(DISTINCT team_id) AS team_id_count,
            COUNT(*) AS roster_occurrences,
            GROUP_CONCAT(DISTINCT team_id ORDER BY team_id SEPARATOR ',') AS team_ids,
            GROUP_CONCAT(DISTINCT CONCAT(team_id, ' | ', COALESCE(team_name, '')) ORDER BY team_id SEPARATOR ';;') AS team_id_names,
            GROUP_CONCAT(DISTINCT match_id ORDER BY match_id SEPARATOR ',') AS match_ids,
            MIN(first_seen) AS first_seen,
            MAX(last_seen) AS last_seen
          FROM team_rosters tr
          LEFT JOIN league_names ln ON tr.league_id = ln.league_id
          GROUP BY tr.league_id, tr.roster_key
          HAVING COUNT(DISTINCT team_id) > 1
        )`;

  const sql = `WITH ${buildAnalysisCtes(matchFilters, filters)},
    ${anomalySql}
    SELECT * FROM anomalies
    ORDER BY league_id, team_id_count DESC, roster_occurrences DESC, roster_key
    ${limitClause}`;
  if (opts.limit) params.push(opts.limit);
  return { sql, params };
}

function buildFuzzyBaseSql(opts: DetectOptions): {
  sql: string;
  params: Array<string | number>;
} {
  const { matchFilters, filters, params } = analysisFilters(opts);
  const sql = `WITH ${buildAnalysisCtes(matchFilters, filters)}
    SELECT
      tr.league_id,
      COALESCE(ln.league_name, '') AS league_name,
      tr.team_id,
      tr.team_name,
      tr.roster_key,
      tr.roster_players,
      tr.match_id,
      tr.first_seen,
      tr.last_seen
    FROM team_rosters tr
    LEFT JOIN league_names ln ON tr.league_id = ln.league_id`;
  return { sql, params };
}

function combinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = [];
  const combo: T[] = [];
  const helper = (start: number) => {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i += 1) {
      combo.push(arr[i]);
      helper(i + 1);
      combo.pop();
    }
  };
  helper(0);
  return result;
}

interface FuzzyGroup {
  core: string[];
  coreNames: Record<string, string>;
  teamIds: Map<string, string>;
  leagues: Map<string, string>;
  matches: Set<string>;
  occurrences: number;
  firstSeen: number | null;
  lastSeen: number | null;
}

type BaseRow = Record<string, unknown>;

// 模糊聚类：以 K=5-maxDiff 个共享核心选手为分组键，识别换人后仍是同队的多个 team_id
function clusterFuzzyRosters(
  baseRows: BaseRow[],
  opts: DetectOptions
): AnomalyRow[] {
  const coreSize = 5 - opts.maxDiff;
  const cross = opts.mode === "cross_league";
  const groups = new Map<string, FuzzyGroup>();

  for (const row of baseRows) {
    const players = String(row.roster_key ?? "")
      .split(",")
      .filter(Boolean);
    if (players.length !== 5) continue;

    const nameMap: Record<string, string> = {};
    for (const rawPiece of String(row.roster_players ?? "").split(";;")) {
      const piece = rawPiece.trim();
      if (!piece) continue;
      const idx = piece.indexOf(" | ");
      if (idx >= 0) {
        nameMap[piece.slice(0, idx).trim()] = piece.slice(idx + 3).trim();
      } else if (!(piece in nameMap)) {
        nameMap[piece] = "";
      }
    }

    const teamId = String(row.team_id ?? "").trim();
    const teamName = String(row.team_name ?? "").trim();
    const leagueId = String(row.league_id ?? "").trim();
    const leagueName = String(row.league_name ?? "").trim();
    const matchId = String(row.match_id ?? "").trim();
    const firstSeen = toIntOrNull(row.first_seen);
    const lastSeen = toIntOrNull(row.last_seen);

    const sortedPlayers = players.slice().sort();
    for (const combo of combinations(sortedPlayers, coreSize)) {
      const gkey = cross ? combo.join(",") : `${leagueId}\u0000${combo.join(",")}`;
      let group = groups.get(gkey);
      if (!group) {
        const coreNames: Record<string, string> = {};
        for (const p of combo) coreNames[p] = nameMap[p] ?? "";
        group = {
          core: combo.slice(),
          coreNames,
          teamIds: new Map(),
          leagues: new Map(),
          matches: new Set(),
          occurrences: 0,
          firstSeen: null,
          lastSeen: null,
        };
        groups.set(gkey, group);
      }

      if (teamId) {
        if (teamName || !group.teamIds.has(teamId)) {
          group.teamIds.set(teamId, teamName || group.teamIds.get(teamId) || "");
        }
      }
      if (leagueId && !group.leagues.has(leagueId)) {
        group.leagues.set(leagueId, leagueName);
      }
      if (matchId) group.matches.add(matchId);
      group.occurrences += 1;
      if (firstSeen !== null) {
        group.firstSeen = group.firstSeen === null ? firstSeen : Math.min(group.firstSeen, firstSeen);
      }
      if (lastSeen !== null) {
        group.lastSeen = group.lastSeen === null ? lastSeen : Math.max(group.lastSeen, lastSeen);
      }
    }
  }

  let candidates = Array.from(groups.values()).filter((g) => {
    if (g.teamIds.size <= 1) return false;
    if (cross && g.leagues.size <= 1) return false;
    return true;
  });

  // 剪枝：若某组的队伍集合与比赛集合被更大的组完全包含，则丢弃，避免重叠子核
  candidates.sort(
    (a, b) => b.matches.size - a.matches.size || b.teamIds.size - a.teamIds.size
  );
  const kept: FuzzyGroup[] = [];
  for (const group of candidates) {
    const teams = new Set(group.teamIds.keys());
    const contained = kept.some((big) => {
      const bigTeams = new Set(big.teamIds.keys());
      const teamsSubset = [...teams].every((t) => bigTeams.has(t));
      const matchesSubset = [...group.matches].every((m) => big.matches.has(m));
      return teamsSubset && matchesSubset;
    });
    if (!contained) kept.push(group);
  }

  let rows = kept.map((g) => fuzzyGroupToRow(g, cross));
  if (cross) {
    rows.sort((a, b) => b.team_id_count - a.team_id_count || b.roster_occurrences - a.roster_occurrences);
  } else {
    rows.sort(
      (a, b) =>
        String(a.league_id).localeCompare(String(b.league_id)) ||
        b.team_id_count - a.team_id_count ||
        b.roster_occurrences - a.roster_occurrences
    );
  }
  if (opts.limit) rows = rows.slice(0, opts.limit);
  return rows;
}

function fuzzyGroupToRow(group: FuzzyGroup, cross: boolean): AnomalyRow {
  const core = group.core.slice().sort();
  const teamIds = Array.from(group.teamIds.keys()).sort();
  const leagues = Array.from(group.leagues.keys()).sort();
  const matches = Array.from(group.matches).sort();
  const rosterPlayers = core.map((p) => `${p} | ${group.coreNames[p] ?? ""}`).join(";;");
  const teamIdNames = teamIds.map((t) => `${t} | ${group.teamIds.get(t) ?? ""}`).join(";;");
  let leagueId: string;
  let leagueName: string;
  if (cross) {
    leagueId = leagues.join(",");
    leagueName = leagues.map((l) => `${l} | ${group.leagues.get(l) ?? ""}`).join(";;");
  } else {
    leagueId = leagues[0] ?? "";
    leagueName = leagues.length ? group.leagues.get(leagueId) ?? "" : "";
  }
  return {
    league_id: leagueId,
    league_name: leagueName,
    roster_key: core.join(","),
    roster_players: rosterPlayers,
    league_count: leagues.length,
    team_id_count: teamIds.length,
    roster_occurrences: group.occurrences,
    team_ids: teamIds.join(","),
    team_id_names: teamIdNames,
    match_ids: matches.join(","),
    first_seen: group.firstSeen ?? "",
    last_seen: group.lastSeen ?? "",
  };
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function normalizeAnomalyRow(r: Record<string, unknown>): AnomalyRow {
  return {
    league_id: String(r.league_id ?? ""),
    league_name: String(r.league_name ?? ""),
    roster_key: String(r.roster_key ?? ""),
    roster_players: String(r.roster_players ?? ""),
    league_count: Number(r.league_count ?? 0),
    team_id_count: Number(r.team_id_count ?? 0),
    roster_occurrences: Number(r.roster_occurrences ?? 0),
    team_ids: String(r.team_ids ?? ""),
    team_id_names: String(r.team_id_names ?? ""),
    match_ids: String(r.match_ids ?? ""),
    first_seen: toIntOrNull(r.first_seen) ?? "",
    last_seen: toIntOrNull(r.last_seen) ?? "",
  };
}

export async function detectSameRoster(opts: DetectOptions): Promise<AnomalyRow[]> {
  return withConnection(async (conn) => {
    if (opts.maxDiff === 0) {
      const { sql, params } = buildExactDetectionSql(opts);
      const [rows] = await conn.query(sql, params);
      return (rows as Array<Record<string, unknown>>).map(normalizeAnomalyRow);
    }
    const { sql, params } = buildFuzzyBaseSql(opts);
    const [rows] = await conn.query(sql, params);
    return clusterFuzzyRosters(rows as BaseRow[], opts);
  });
}

export interface PlayerCandidate {
  steamid: string;
  name: string;
}

export async function searchPlayerCandidates(query: string): Promise<PlayerCandidate[]> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `SELECT CAST(steamid AS VARCHAR) AS steamid, MAX(name) AS name
       FROM ${SCHEMA}.\`pro_players\`
       WHERE steamid IS NOT NULL AND name LIKE ?
       GROUP BY CAST(steamid AS VARCHAR)
       ORDER BY MAX(name)
       LIMIT 50`,
      [`%${query}%`]
    );
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      steamid: String(r.steamid ?? ""),
      name: String(r.name ?? ""),
    }));
  });
}

export interface PlayerTrackLeagueRef {
  league_id: string;
  league_name: string;
  match_count: number;
}

export interface PlayerTrackTeamRef {
  team_id: string;
  team_name: string;
  match_count: number;
}

export interface PlayerTrackTeam extends PlayerTrackTeamRef {
  leagues: PlayerTrackLeagueRef[];
  first_seen: number | string;
  last_seen: number | string;
}

export interface PlayerTrackLeague extends PlayerTrackLeagueRef {
  teams: PlayerTrackTeamRef[];
  first_seen: number | string;
  last_seen: number | string;
}

export interface PlayerTrackResult {
  steamid: string;
  player_name: string;
  total_matches: number;
  team_count: number;
  league_count: number;
  teams: PlayerTrackTeam[];
  leagues: PlayerTrackLeague[];
}

export async function trackPlayer(
  steamid: string,
  opts: { startTime?: string | null; endTime?: string | null } = {}
): Promise<PlayerTrackResult> {
  return withConnection(async (conn) => {
    const [nameRows] = await conn.query(
      `SELECT MAX(name) AS name FROM ${SCHEMA}.\`pro_players\` WHERE CAST(steamid AS VARCHAR) = ?`,
      [steamid]
    );
    const nameList = nameRows as Array<Record<string, unknown>>;
    const playerName = nameList.length ? String(nameList[0].name ?? "") : "";

    const matchFilters = [
      "match_id IS NOT NULL",
      "CAST(match_id AS VARCHAR) <> '0'",
      "league_id IS NOT NULL",
    ];
    const params: Array<string | number> = [];
    const startTime = parseTimeFilter(opts.startTime);
    const endTime = parseTimeFilter(opts.endTime, true);
    if (startTime !== null) {
      matchFilters.push("end_time >= ?");
      params.push(startTime);
    }
    if (endTime !== null) {
      matchFilters.push("end_time <= ?");
      params.push(endTime);
    }
    params.push(steamid);

    const sql = `WITH league_names AS (
        SELECT CAST(league_id AS VARCHAR) AS league_id, MAX(league_name) AS league_name
        FROM (
          SELECT league_id, league_name FROM ${SCHEMA}.\`pro_match_list\`
          UNION ALL
          SELECT league_id, league_name FROM ${SCHEMA}.\`pro_match_list_2\`
          UNION ALL
          SELECT league_id, league_name FROM ${SCHEMA}.\`match_info_upload\`
        ) names
        WHERE league_id IS NOT NULL AND league_name IS NOT NULL AND league_name <> ''
        GROUP BY CAST(league_id AS VARCHAR)
      ),
      match_info_dedup AS (
        SELECT
          CAST(match_id AS VARCHAR) AS match_id,
          CAST(MAX(league_id) AS VARCHAR) AS league_id,
          CAST(MAX(radiant_team_id) AS VARCHAR) AS radiant_team_id,
          CAST(MAX(dire_team_id) AS VARCHAR) AS dire_team_id,
          MAX(radiant_team_tag) AS radiant_team_name,
          MAX(dire_team_tag) AS dire_team_name,
          MIN(end_time) AS match_time
        FROM ${SCHEMA}.\`match_info\`
        WHERE ${matchFilters.join(" AND ")}
        GROUP BY CAST(match_id AS VARCHAR)
      ),
      player_rows AS (
        SELECT
          mi.league_id,
          mi.match_id,
          CASE
            WHEN p.team = 2 THEN mi.radiant_team_id
            WHEN p.team = 3 THEN mi.dire_team_id
            WHEN p.slot BETWEEN 0 AND 4 THEN mi.radiant_team_id
            WHEN p.slot BETWEEN 5 AND 9 THEN mi.dire_team_id
          END AS team_id,
          CASE
            WHEN p.team = 2 THEN mi.radiant_team_name
            WHEN p.team = 3 THEN mi.dire_team_name
            WHEN p.slot BETWEEN 0 AND 4 THEN mi.radiant_team_name
            WHEN p.slot BETWEEN 5 AND 9 THEN mi.dire_team_name
          END AS team_name,
          mi.match_time
        FROM ${SCHEMA}.\`players\` p
        JOIN match_info_dedup mi ON CAST(p.match_id AS VARCHAR) = mi.match_id
        WHERE CAST(p.steamid AS VARCHAR) = ? AND CAST(p.match_id AS VARCHAR) <> '0'
      )
      SELECT
        CAST(pr.team_id AS VARCHAR) AS team_id,
        MAX(pr.team_name) AS team_name,
        pr.league_id AS league_id,
        MAX(ln.league_name) AS league_name,
        COUNT(DISTINCT pr.match_id) AS match_count,
        MIN(pr.match_time) AS first_seen,
        MAX(pr.match_time) AS last_seen
      FROM player_rows pr
      LEFT JOIN league_names ln ON pr.league_id = ln.league_id
      WHERE pr.team_id IS NOT NULL AND CAST(pr.team_id AS VARCHAR) <> '0'
      GROUP BY CAST(pr.team_id AS VARCHAR), pr.league_id
      ORDER BY match_count DESC`;

    const [rows] = await conn.query(sql, params);
    const list = rows as Array<Record<string, unknown>>;

    const teams = new Map<string, PlayerTrackTeam>();
    const leagues = new Map<string, PlayerTrackLeague>();
    let totalMatches = 0;

    for (const row of list) {
      const teamId = String(row.team_id ?? "");
      const teamName = String(row.team_name ?? "");
      const leagueId = String(row.league_id ?? "");
      const leagueName = String(row.league_name ?? "");
      const matchCount = Number(row.match_count ?? 0);
      const firstSeen = toIntOrNull(row.first_seen);
      const lastSeen = toIntOrNull(row.last_seen);
      totalMatches += matchCount;

      let team = teams.get(teamId);
      if (!team) {
        team = {
          team_id: teamId,
          team_name: teamName,
          match_count: 0,
          leagues: [],
          first_seen: "",
          last_seen: "",
        };
        teams.set(teamId, team);
      }
      if (teamName && !team.team_name) team.team_name = teamName;
      team.match_count += matchCount;
      team.leagues.push({ league_id: leagueId, league_name: leagueName, match_count: matchCount });
      team.first_seen = mergeMin(team.first_seen, firstSeen);
      team.last_seen = mergeMax(team.last_seen, lastSeen);

      let league = leagues.get(leagueId);
      if (!league) {
        league = {
          league_id: leagueId,
          league_name: leagueName,
          match_count: 0,
          teams: [],
          first_seen: "",
          last_seen: "",
        };
        leagues.set(leagueId, league);
      }
      if (leagueName && !league.league_name) league.league_name = leagueName;
      league.match_count += matchCount;
      league.teams.push({ team_id: teamId, team_name: teamName, match_count: matchCount });
      league.first_seen = mergeMin(league.first_seen, firstSeen);
      league.last_seen = mergeMax(league.last_seen, lastSeen);
    }

    const teamList = Array.from(teams.values()).sort((a, b) => b.match_count - a.match_count);
    const leagueList = Array.from(leagues.values()).sort((a, b) => b.match_count - a.match_count);
    for (const team of teamList) team.leagues.sort((a, b) => b.match_count - a.match_count);
    for (const league of leagueList) league.teams.sort((a, b) => b.match_count - a.match_count);

    return {
      steamid,
      player_name: playerName,
      total_matches: totalMatches,
      team_count: teamList.length,
      league_count: leagueList.length,
      teams: teamList,
      leagues: leagueList,
    };
  });
}

function mergeMin(current: number | string, value: number | null): number | string {
  if (value === null) return current;
  if (current === "" || typeof current !== "number") return value;
  return Math.min(current, value);
}

function mergeMax(current: number | string, value: number | null): number | string {
  if (value === null) return current;
  if (current === "" || typeof current !== "number") return value;
  return Math.max(current, value);
}

// ===== 战队队徽（Dota2 官方接口，内存缓存）=====

export interface TeamInfo {
  team_id: string;
  name: string;
  tag: string;
  logo_url: string;
}

const TEAM_INFO_CACHE = new Map<string, TeamInfo>();
const TEAM_INFO_URL =
  "https://www.dota2.com/webapi/IDOTA2Teams/GetSingleTeamInfo/v001?team_id=";

export async function fetchTeamInfo(teamIdRaw: string): Promise<TeamInfo> {
  const teamId = String(teamIdRaw).trim();
  const empty: TeamInfo = { team_id: teamId, name: "", tag: "", logo_url: "" };
  if (!teamId || !/^\d+$/.test(teamId) || teamId === "0") return empty;
  const cached = TEAM_INFO_CACHE.get(teamId);
  if (cached) return cached;
  try {
    const res = await fetch(TEAM_INFO_URL + teamId, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as Record<string, unknown>;
    const info: TeamInfo = {
      team_id: teamId,
      name: String(data.name ?? ""),
      tag: String(data.tag ?? ""),
      logo_url: String(data.url_logo ?? ""),
    };
    TEAM_INFO_CACHE.set(teamId, info);
    return info;
  } catch {
    return empty;
  }
}

export async function fetchTeamInfos(teamIds: string[]): Promise<Record<string, TeamInfo>> {
  const result: Record<string, TeamInfo> = {};
  await Promise.all(
    teamIds.map(async (id) => {
      result[id] = await fetchTeamInfo(id);
    })
  );
  return result;
}
