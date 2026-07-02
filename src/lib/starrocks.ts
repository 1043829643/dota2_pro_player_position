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
  // 局内分路：1=安全路 2=中路 3=优势路 4=打野。用于精确判位。
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
    // 不再要求联赛名非空：有比赛但无名的联赛（如名字维表尚未补全）也一并返回，
    // 名字为空时前端展示为「未命名联赛 #<id>」。
    const [summaryRows] = await conn.query(
      `SELECT league_id, MAX(league_name) AS league_name, COUNT(*) AS match_count,
              DATE_FORMAT(MIN(start_date), '%Y-%m-%d') AS first_date,
              DATE_FORMAT(MAX(start_date), '%Y-%m-%d') AS last_date,
              group_concat(DISTINCT patch_version) AS patches
       FROM dwd_match_overview
       WHERE league_id IS NOT NULL AND league_id > 0
       GROUP BY league_id
       ORDER BY match_count DESC`
    );

    const [teamRows] = await conn.query(
      `SELECT league_id, team_name FROM (
         SELECT league_id, team_name_1 AS team_name FROM dwd_match_overview
           WHERE team_name_1 IS NOT NULL AND team_name_1 <> ''
         UNION
         SELECT league_id, team_name_2 AS team_name FROM dwd_match_overview
           WHERE team_name_2 IS NOT NULL AND team_name_2 <> ''
       ) t
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
      `SELECT
         CASE
           WHEN mp.team = 2 THEN mo.team_name_1
           WHEN mp.team = 3 THEN mo.team_name_2
           ELSE NULL
         END AS team_name,
         mp.steamid,
         mp.name,
         mp.hits_5m,
         mp.lane_role
       FROM dwd_match_player_positions mp
       JOIN dwd_match_overview mo ON mo.match_id = mp.match_id
       WHERE mo.league_id = ?
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

    // 兜底：部分新/公开预选赛尚未写入 dwd_match_player_positions，
    // 但 dota2_analysis.players 已有逐场选手，且 player_intervals2 里有逐分钟补刀/经济。
    // 这里取每场 10 分钟(time=600)的真实补刀 lh 作为分路信号（与标准算法的 hits_5m 同义），
    // 交给 buildLineups 按“人均补刀从高到低 = 1→5 号位”重建，纯用本届联赛数据判位。
    const [analysisRows] = await conn.query(
      `SELECT
         COALESCE(
           NULLIF(CASE WHEN p.team = 2 THEN mo.team_name_1 WHEN p.team = 3 THEN mo.team_name_2 END, ''),
           NULLIF(CASE WHEN p.team = 2 THEN mi.radiant_team_tag WHEN p.team = 3 THEN mi.dire_team_tag END, ''),
           CASE
             WHEN p.team = 2 THEN CONCAT('Team ', mi.radiant_team_id)
             WHEN p.team = 3 THEN CONCAT('Team ', mi.dire_team_id)
           END
         ) AS team_name,
         CAST(p.steamid AS CHAR) AS steamid,
         COALESCE(NULLIF(pp.name, ''), NULLIF(p.persona, ''), CAST(p.steamid AS CHAR)) AS name,
         p.slot,
         CAST(pi.lh AS SIGNED) AS hits_5m
       FROM dwd_match_overview mo
       JOIN dota2_analysis.players p ON CAST(p.match_id AS BIGINT) = mo.match_id
       LEFT JOIN dota2_analysis.match_info mi ON CAST(mi.match_id AS BIGINT) = mo.match_id
       LEFT JOIN dota2_analysis.pro_players pp ON CAST(pp.steamid AS BIGINT) = p.steamid
       LEFT JOIN dota2_analysis.player_intervals2 pi
         ON pi.match_id = p.match_id AND pi.slot = p.slot AND pi.time = 600
       WHERE mo.league_id = ?
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
      `SELECT team_name, team_id, COUNT(*) AS cnt FROM (
         SELECT mo.team_name_1 AS team_name, CAST(mi.radiant_team_id AS CHAR) AS team_id
         FROM dwd_match_overview mo
         JOIN dota2_analysis.match_info mi ON CAST(mi.match_id AS BIGINT) = mo.match_id
         WHERE mo.league_id = ?
           AND mo.team_name_1 IS NOT NULL AND mo.team_name_1 <> ''
           AND mi.radiant_team_id IS NOT NULL AND mi.radiant_team_id <> 0
         UNION ALL
         SELECT mo.team_name_2, CAST(mi.dire_team_id AS CHAR)
         FROM dwd_match_overview mo
         JOIN dota2_analysis.match_info mi ON CAST(mi.match_id AS BIGINT) = mo.match_id
         WHERE mo.league_id = ?
           AND mo.team_name_2 IS NOT NULL AND mo.team_name_2 <> ''
           AND mi.dire_team_id IS NOT NULL AND mi.dire_team_id <> 0
       ) t
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

// 拉取某联赛在比赛总览表里的队伍列表。
// 有些新联赛只有 match_overview 队伍信息，尚未落入 player_positions；
// 此时导入时先创建空阵容队伍，方便后续手工维护。
export async function fetchLeagueTeams(leagueId: string): Promise<LeagueTeamRow[]> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `SELECT team_name, COUNT(*) AS match_count FROM (
         SELECT team_name_1 AS team_name
         FROM dwd_match_overview
         WHERE league_id = ? AND team_name_1 IS NOT NULL AND team_name_1 <> ''
         UNION ALL
         SELECT team_name_2 AS team_name
         FROM dwd_match_overview
         WHERE league_id = ? AND team_name_2 IS NOT NULL AND team_name_2 <> ''
       ) t
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
      `SELECT MAX(league_name) AS league_name
       FROM dwd_match_overview
       WHERE league_id = ?`,
      [leagueId]
    );
    const list = rows as Array<Record<string, unknown>>;
    const dwdName = list.length > 0 && list[0].league_name != null
      ? String(list[0].league_name).trim()
      : "";
    if (dwdName) return dwdName;

    const [fallbackRows] = await conn.query(
      `SELECT MAX(league_name) AS league_name
       FROM dota2_analysis.pro_match_list_2
       WHERE league_id = ?`,
      [leagueId]
    );
    const fallback = fallbackRows as Array<Record<string, unknown>>;
    if (fallback.length === 0 || fallback[0].league_name == null) return null;
    const fallbackName = String(fallback[0].league_name).trim();
    return fallbackName || null;
  });
}
