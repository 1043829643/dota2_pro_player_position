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
}

async function withConnection<T>(
  fn: (conn: mysql.Connection) => Promise<T>
): Promise<T> {
  const conn = await mysql.createConnection({
    ...STARROCKS_CONFIG,
    connectTimeout: 15000,
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
      `SELECT league_id, MAX(league_name) AS league_name, COUNT(*) AS match_count,
              DATE_FORMAT(MIN(start_date), '%Y-%m-%d') AS first_date,
              DATE_FORMAT(MAX(start_date), '%Y-%m-%d') AS last_date,
              group_concat(DISTINCT patch_version) AS patches
       FROM dwd_match_overview
       WHERE league_id IS NOT NULL AND league_id > 0
         AND league_name IS NOT NULL AND league_name <> ''
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
      return {
        league_id: lid,
        league_name: String(r.league_name ?? ""),
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
         mp.hits_5m
       FROM dwd_match_player_positions mp
       JOIN dwd_match_overview mo ON mo.match_id = mp.match_id
       WHERE mo.league_id = ?
         AND mp.steamid IS NOT NULL AND mp.steamid <> ''`,
      [leagueId]
    );
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      team_name: r.team_name == null ? null : String(r.team_name),
      steamid: r.steamid == null ? null : String(r.steamid),
      name: r.name == null ? null : String(r.name),
      hits_5m: r.hits_5m == null ? null : Number(r.hits_5m),
    }));
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
    if (list.length === 0 || list[0].league_name == null) return null;
    return String(list[0].league_name);
  });
}
