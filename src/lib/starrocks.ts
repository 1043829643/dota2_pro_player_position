import mysql from "mysql2/promise";

// StarRocks 兼容 MySQL 协议，这里直连只读账号查询联赛与比赛明细。
// 允许通过环境变量覆盖，缺省使用既有只读账号。
const STARROCKS_CONFIG = {
  host: process.env.STARROCKS_HOST ?? "47.86.96.51",
  port: Number(process.env.STARROCKS_PORT ?? 9030),
  user: process.env.STARROCKS_USER ?? "dota2_reader",
  password: process.env.STARROCKS_PASSWORD ?? "readerDota.",
  database: process.env.STARROCKS_DB ?? "dwd_dota2",
};

const ANALYSIS_SCHEMA = "dota2_analysis";

// 联赛名来自 pro_match_list / pro_match_list_2 / match_info_upload 维表。
const LEAGUE_NAMES_CTE = `
  league_names AS (
    SELECT CAST(league_id AS CHAR) AS league_id, MAX(league_name) AS league_name
    FROM (
      SELECT league_id, league_name FROM ${ANALYSIS_SCHEMA}.pro_match_list
      UNION ALL
      SELECT league_id, league_name FROM ${ANALYSIS_SCHEMA}.pro_match_list_2
      UNION ALL
      SELECT league_id, league_name FROM ${ANALYSIS_SCHEMA}.match_info_upload
    ) names
    WHERE league_id IS NOT NULL AND league_name IS NOT NULL AND league_name <> ''
    GROUP BY CAST(league_id AS CHAR)
  )`;

// match_info 按 match_id 去重（同场可能有多条记录）。
const MATCH_INFO_DEDUP_CTE = `
  match_info_dedup AS (
    SELECT
      CAST(match_id AS CHAR) AS match_id,
      CAST(MAX(league_id) AS CHAR) AS league_id,
      CAST(MAX(radiant_team_id) AS CHAR) AS radiant_team_id,
      MAX(radiant_team_tag) AS radiant_team_tag,
      CAST(MAX(dire_team_id) AS CHAR) AS dire_team_id,
      MAX(dire_team_tag) AS dire_team_tag,
      MIN(end_time) AS end_time
    FROM ${ANALYSIS_SCHEMA}.match_info
    WHERE league_id IS NOT NULL AND league_id > 0
    GROUP BY CAST(match_id AS CHAR)
  )`;

export interface LeagueCatalogRow {
  league_id: string;
  league_name: string;
  match_count: number;
  first_date: string | null;
  last_date: string | null;
  patch_versions: string[];
  teams: string[];
}

export interface LeaguePlayerRow {
  team_name: string | null;
  steamid: string | null;
  name: string | null;
  hits_5m: number | null;
  // 局内分路：1=优势路(1/5号位) 2=中路(2号位) 3=劣势路(3/4号位) 4=打野。用于精确判位。
  lane_role?: number | null;
  slot?: number | null;
}

export interface LeagueTeamRow {
  team_name: string;
  match_count: number;
  team_id?: string | null;
}

async function withConnection<T>(
  fn: (conn: mysql.Connection) => Promise<T>
): Promise<T> {
  const conn = await mysql.createConnection({
    ...STARROCKS_CONFIG,
    connectTimeout: 15000,
    // steamid64 等 17 位整数超出 JS Number 安全范围（2^53），
    // 若按默认返回为 number 会丢末位精度。开启后这类超大 BIGINT 以字符串原样返回，
    // 小整数（slot、team、场次等）不受影响仍为 number。
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

// 列出所有出现过的联赛（按比赛场次倒序），附带时间范围、版本号、参赛队伍
export async function listAllLeagues(): Promise<LeagueCatalogRow[]> {
  return withConnection(async (conn) => {
    const [summaryRows] = await conn.query(
      `WITH ${LEAGUE_NAMES_CTE},
       ${MATCH_INFO_DEDUP_CTE},
       league_patches AS (
         SELECT CAST(league_id AS CHAR) AS league_id,
                group_concat(DISTINCT patch_version) AS patches
         FROM ${ANALYSIS_SCHEMA}.pro_match_list_2
         WHERE league_id IS NOT NULL
           AND patch_version IS NOT NULL AND patch_version <> ''
         GROUP BY CAST(league_id AS CHAR)
       )
       SELECT
         mi.league_id,
         ln.league_name,
         COUNT(*) AS match_count,
         DATE_FORMAT(FROM_UNIXTIME(MIN(mi.end_time)), '%Y-%m-%d') AS first_date,
         DATE_FORMAT(FROM_UNIXTIME(MAX(mi.end_time)), '%Y-%m-%d') AS last_date,
         MAX(lp.patches) AS patches
       FROM match_info_dedup mi
       LEFT JOIN league_names ln ON ln.league_id = mi.league_id
       LEFT JOIN league_patches lp ON lp.league_id = mi.league_id
       GROUP BY mi.league_id, ln.league_name
       ORDER BY match_count DESC`
    );

    const [teamRows] = await conn.query(
      `WITH ${MATCH_INFO_DEDUP_CTE}
       SELECT league_id, team_name FROM (
         SELECT mi.league_id,
                COALESCE(NULLIF(mi.radiant_team_tag, ''), mi.radiant_team_id) AS team_name
         FROM match_info_dedup mi
         WHERE mi.radiant_team_id IS NOT NULL AND mi.radiant_team_id <> '0'
         UNION
         SELECT mi.league_id,
                COALESCE(NULLIF(mi.dire_team_tag, ''), mi.dire_team_id) AS team_name
         FROM match_info_dedup mi
         WHERE mi.dire_team_id IS NOT NULL AND mi.dire_team_id <> '0'
       ) t
       WHERE team_name IS NOT NULL AND team_name <> ''
       GROUP BY league_id, team_name`
    );

    const teamsByLeague = new Map<string, string[]>();
    for (const r of teamRows as Array<Record<string, unknown>>) {
      const lid = String(r.league_id);
      const list = teamsByLeague.get(lid) ?? [];
      const name = String(r.team_name ?? "").trim();
      if (name) list.push(name);
      teamsByLeague.set(lid, list);
    }

    return (summaryRows as Array<Record<string, unknown>>).map((r) => {
      const lid = String(r.league_id);
      const patches = String(r.patches ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const teams = (teamsByLeague.get(lid) ?? []).sort((a, b) =>
        a.localeCompare(b)
      );
      const rawName = String(r.league_name ?? "").trim();
      return {
        league_id: lid,
        league_name: rawName || `未命名联赛 #${lid}`,
        match_count: Number(r.match_count ?? 0),
        first_date: r.first_date == null ? null : String(r.first_date),
        last_date: r.last_date == null ? null : String(r.last_date),
        patch_versions: patches,
        teams,
      };
    });
  });
}

// 拉取某联赛的逐场选手明细，用于启发式重建阵容
export async function fetchLeaguePlayerRows(
  leagueId: string
): Promise<LeaguePlayerRow[]> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `WITH ${MATCH_INFO_DEDUP_CTE}
       SELECT
         COALESCE(
           NULLIF(CASE WHEN mp.team = 2 THEN mi.radiant_team_tag WHEN mp.team = 3 THEN mi.dire_team_tag END, ''),
           CASE WHEN mp.team = 2 THEN mi.radiant_team_id WHEN mp.team = 3 THEN mi.dire_team_id END
         ) AS team_name,
         mp.steamid,
         mp.name,
         mp.hits_5m,
         mp.lane_role
       FROM dwd_match_player_positions mp
       JOIN match_info_dedup mi ON CAST(mi.match_id AS BIGINT) = mp.match_id
       WHERE mi.league_id = ?
         AND mp.steamid IS NOT NULL AND mp.steamid <> ''`,
      [leagueId]
    );
    const positionRows = (rows as Array<Record<string, unknown>>).map((r) => ({
      team_name: r.team_name == null ? null : String(r.team_name),
      steamid: r.steamid == null ? null : String(r.steamid),
      name: r.name == null ? null : String(r.name),
      hits_5m: r.hits_5m == null ? null : Number(r.hits_5m),
      lane_role: r.lane_role == null ? null : Number(r.lane_role),
      slot: null,
    }));
    if (positionRows.length > 0) return positionRows;

    // 兜底：无 dwd_match_player_positions 时，用 players + player_intervals2 重建。
    const [analysisRows] = await conn.query(
      `WITH ${MATCH_INFO_DEDUP_CTE}
       SELECT
         COALESCE(
           NULLIF(CASE WHEN p.team = 2 THEN mi.radiant_team_tag WHEN p.team = 3 THEN mi.dire_team_tag END, ''),
           CASE WHEN p.team = 2 THEN CONCAT('Team ', mi.radiant_team_id) WHEN p.team = 3 THEN CONCAT('Team ', mi.dire_team_id) END
         ) AS team_name,
         CAST(p.steamid AS CHAR) AS steamid,
         COALESCE(NULLIF(pp.name, ''), NULLIF(p.persona, ''), CAST(p.steamid AS CHAR)) AS name,
         p.slot,
         CAST(pi.lh AS SIGNED) AS hits_5m
       FROM match_info_dedup mi
       JOIN ${ANALYSIS_SCHEMA}.players p ON CAST(p.match_id AS BIGINT) = CAST(mi.match_id AS BIGINT)
       LEFT JOIN ${ANALYSIS_SCHEMA}.pro_players pp ON CAST(pp.steamid AS BIGINT) = p.steamid
       LEFT JOIN ${ANALYSIS_SCHEMA}.player_intervals2 pi
         ON pi.match_id = p.match_id AND pi.slot = p.slot AND pi.time = 600
       WHERE mi.league_id = ?
         AND p.steamid IS NOT NULL`,
      [leagueId]
    );
    return (analysisRows as Array<Record<string, unknown>>).map((r) => ({
      team_name: r.team_name == null ? null : String(r.team_name),
      steamid: r.steamid == null ? null : String(r.steamid),
      name: r.name == null ? null : String(r.name),
      hits_5m: r.hits_5m == null ? null : Number(r.hits_5m),
      lane_role: null,
      slot: r.slot == null ? null : Number(r.slot),
    }));
  });
}

// 拉取某联赛各队伍在 match_info 中最常出现的真实 Dota2 team_id（用于队徽 API）。
export async function fetchLeagueTeamExternalIds(
  leagueId: string
): Promise<Map<string, string>> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `WITH ${MATCH_INFO_DEDUP_CTE}
       SELECT team_name, team_id, COUNT(*) AS cnt FROM (
         SELECT
           COALESCE(NULLIF(mi.radiant_team_tag, ''), mi.radiant_team_id) AS team_name,
           mi.radiant_team_id AS team_id
         FROM match_info_dedup mi
         WHERE mi.league_id = ?
           AND mi.radiant_team_id IS NOT NULL AND mi.radiant_team_id <> '0'
         UNION ALL
         SELECT
           COALESCE(NULLIF(mi.dire_team_tag, ''), mi.dire_team_id),
           mi.dire_team_id
         FROM match_info_dedup mi
         WHERE mi.league_id = ?
           AND mi.dire_team_id IS NOT NULL AND mi.dire_team_id <> '0'
       ) t
       WHERE team_name IS NOT NULL AND team_name <> ''
       GROUP BY team_name, team_id`,
      [leagueId, leagueId]
    );
    const counts = new Map<string, Map<string, number>>();
    for (const r of rows as Array<Record<string, unknown>>) {
      const name = String(r.team_name ?? "").trim();
      const tid = String(r.team_id ?? "").trim();
      const cnt = Number(r.cnt ?? 0);
      if (!name || !tid || !/^\d+$/.test(tid)) continue;
      const byId = counts.get(name) ?? new Map<string, number>();
      byId.set(tid, (byId.get(tid) ?? 0) + cnt);
      counts.set(name, byId);
    }
    const result = new Map<string, string>();
    for (const [name, byId] of counts.entries()) {
      let bestId = "";
      let bestCnt = -1;
      for (const [tid, c] of byId.entries()) {
        if (c > bestCnt) {
          bestCnt = c;
          bestId = tid;
        }
      }
      if (bestId) result.set(name, bestId);
    }
    return result;
  });
}

// 拉取某联赛在 match_info 里的队伍列表。
export async function fetchLeagueTeams(leagueId: string): Promise<LeagueTeamRow[]> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `WITH ${MATCH_INFO_DEDUP_CTE}
       SELECT team_name, COUNT(*) AS match_count FROM (
         SELECT
           COALESCE(NULLIF(mi.radiant_team_tag, ''), mi.radiant_team_id) AS team_name
         FROM match_info_dedup mi
         WHERE mi.league_id = ?
           AND mi.radiant_team_id IS NOT NULL AND mi.radiant_team_id <> '0'
         UNION ALL
         SELECT
           COALESCE(NULLIF(mi.dire_team_tag, ''), mi.dire_team_id)
         FROM match_info_dedup mi
         WHERE mi.league_id = ?
           AND mi.dire_team_id IS NOT NULL AND mi.dire_team_id <> '0'
       ) t
       WHERE team_name IS NOT NULL AND team_name <> ''
       GROUP BY team_name
       ORDER BY match_count DESC, team_name`,
      [leagueId, leagueId]
    );
    return (rows as Array<Record<string, unknown>>)
      .map((r) => ({
        team_name: String(r.team_name ?? "").trim(),
        match_count: Number(r.match_count ?? 0),
      }))
      .filter((r) => r.team_name);
  });
}

// 查询某联赛的联赛名（导入时使用）
export async function fetchLeagueName(leagueId: string): Promise<string | null> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `WITH ${LEAGUE_NAMES_CTE}
       SELECT league_name FROM league_names WHERE league_id = ?`,
      [leagueId]
    );
    const list = rows as Array<Record<string, unknown>>;
    if (list.length > 0 && list[0].league_name != null) {
      const name = String(list[0].league_name).trim();
      if (name) return name;
    }
    return null;
  });
}

// 查询某联赛最早/最晚一场比赛时间（用于首页展示赛段起止）
export async function fetchLeagueMatchDateRange(leagueId: string): Promise<{
  first_at: string | null;
  last_at: string | null;
}> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `WITH ${MATCH_INFO_DEDUP_CTE}
       SELECT
         DATE_FORMAT(FROM_UNIXTIME(MIN(mi.end_time)), '%Y-%m-%d %H:%i') AS first_at,
         DATE_FORMAT(FROM_UNIXTIME(MAX(mi.end_time)), '%Y-%m-%d %H:%i') AS last_at
       FROM match_info_dedup mi
       WHERE mi.league_id = ?
         AND mi.end_time IS NOT NULL AND mi.end_time > 0`,
      [leagueId]
    );
    const r = (rows as Array<Record<string, unknown>>)[0];
    return {
      first_at: r?.first_at == null ? null : String(r.first_at),
      last_at: r?.last_at == null ? null : String(r.last_at),
    };
  });
}
