import mysql from "mysql2/promise";
import {
  fetchOpenDotaLaneRoles,
  fetchStratzLaneRoles,
  type LaneRole,
  type MatchPlayerLaneRoles,
} from "./external-lane-roles";

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
  lane_source?: "dwd" | "opendota" | "stratz" | "intervals" | "hero_status" | null;
}

export interface LeagueTeamRow {
  team_name: string;
  match_count: number;
  team_id?: string | null;
}

// 联赛名兜底：DB 维表缺名称时用 OpenDota（数据同步自 Valve，免 key）补全，内存缓存。
const LEAGUE_NAME_CACHE = new Map<string, string>();
const OPENDOTA_LEAGUE_URL = "https://api.opendota.com/api/leagues/";

async function fetchOpenDotaLeagueName(leagueId: string): Promise<string> {
  const id = String(leagueId).trim();
  if (!id || !/^\d+$/.test(id)) return "";
  const cached = LEAGUE_NAME_CACHE.get(id);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(OPENDOTA_LEAGUE_URL + id, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as Record<string, unknown>;
    const name = String(data?.name ?? "").trim();
    if (name) LEAGUE_NAME_CACHE.set(id, name);
    return name;
  } catch {
    return "";
  }
}

// 批量补全若干联赛名（并发，忽略失败项）
async function resolveLeagueNames(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const name = await fetchOpenDotaLeagueName(id);
      if (name) result.set(String(id), name);
    })
  );
  return result;
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

    const rows = (summaryRows as Array<Record<string, unknown>>).map((r) => {
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
        rawName,
        match_count: Number(r.match_count ?? 0),
        first_date: r.first_date == null ? null : String(r.first_date),
        last_date: r.last_date == null ? null : String(r.last_date),
        patch_versions: patches,
        teams,
      };
    });

    // DB 维表没有名称的联赛，用 OpenDota 补全（免 key，失败则保留占位名）。
    const missingIds = rows.filter((x) => !x.rawName).map((x) => x.league_id);
    const resolved =
      missingIds.length > 0 ? await resolveLeagueNames(missingIds) : new Map<string, string>();

    return rows.map((x) => ({
      league_id: x.league_id,
      league_name: x.rawName || resolved.get(x.league_id) || `未命名联赛 #${x.league_id}`,
      match_count: x.match_count,
      first_date: x.first_date,
      last_date: x.last_date,
      patch_versions: x.patch_versions,
      teams: x.teams,
    }));
  });
}

interface MatchSideRow {
  match_id: string;
  radiant_team_id: string;
  radiant_team_tag: string;
  dire_team_id: string;
  dire_team_tag: string;
}

interface BasePlayerRow extends LeaguePlayerRow {
  match_id: string;
  team: number;
  slot: number;
}

interface CoordinateSample {
  match_id: string;
  slot: number;
  log_index: number;
  x: number;
  y: number;
}

function finitePlaceholders(values: string[]): string {
  if (values.length === 0) throw new Error("有限 match_id 集合不能为空");
  return values.map(() => "?").join(",");
}

function mapTeamName(match: MatchSideRow, team: number): string {
  if (team === 2) return match.radiant_team_tag || match.radiant_team_id;
  if (team === 3) return match.dire_team_tag || match.dire_team_id;
  return "";
}

function mergeLaneRoles(
  target: Map<string, { role: LaneRole; source: LeaguePlayerRow["lane_source"] }>,
  source: MatchPlayerLaneRoles,
  sourceName: NonNullable<LeaguePlayerRow["lane_source"]>
): void {
  for (const [matchId, players] of source.entries()) {
    for (const [steamid, role] of players.entries()) {
      const key = `${matchId}\u0000${steamid}`;
      if (!target.has(key)) target.set(key, { role, source: sourceName });
    }
  }
}

function matchesMissingLanes(
  rows: BasePlayerRow[],
  lanes: Map<string, { role: LaneRole; source: LeaguePlayerRow["lane_source"] }>
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.steamid || lanes.has(`${row.match_id}\u0000${row.steamid}`)) continue;
    ids.add(row.match_id);
  }
  return [...ids];
}

/**
 * 用给定前期坐标热区判路。数据库坐标是世界坐标的 1/128；
 * 区域与 OpenDota/gem 的 45% 主导热区规则一致。
 */
export function classifyLaneFromCoordinates(
  samples: Array<{ x: number; y: number }>,
  team: number
): LaneRole | null {
  if (samples.length < 6 || (team !== 2 && team !== 3)) return null;
  const counts = new Map<LaneRole, number>();
  let valid = 0;
  for (const sample of samples) {
    const wx = sample.x * 128;
    const wy = sample.y * 128;
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
    valid += 1;
    let radiantZone: 1 | 2 | 3 | 4 | null = null;
    if (Math.abs(wx - wy) < 2000 && wx > 10500 && wx < 22000) {
      radiantZone = 2;
    } else if (wy < 12500 || (wx > 20000 && wy < 16000)) {
      radiantZone = 1;
    } else if (wx < 12500 && wy > 19000) {
      radiantZone = 3;
    } else if (wx >= 12500 && wx <= 20000 && wy >= 12500 && wy <= 19000) {
      radiantZone = 4;
    }
    if (radiantZone == null) continue;
    const role =
      team === 3 && radiantZone === 1
        ? 3
        : team === 3 && radiantZone === 3
          ? 1
          : radiantZone;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  if (valid < 6 || counts.size === 0) return null;
  let dominant: LaneRole | null = null;
  let dominantCount = 0;
  for (const [role, count] of counts.entries()) {
    if (count > dominantCount) {
      dominant = role;
      dominantCount = count;
    }
  }
  return dominant && dominantCount / valid >= 0.45 ? dominant : 5;
}

function coordinateRoles(
  samples: CoordinateSample[],
  players: BasePlayerRow[]
): MatchPlayerLaneRoles {
  const samplesBySlot = new Map<string, Array<{ x: number; y: number }>>();
  for (const sample of samples) {
    const key = `${sample.match_id}\u0000${sample.slot}`;
    const list = samplesBySlot.get(key) ?? [];
    list.push({ x: sample.x, y: sample.y });
    samplesBySlot.set(key, list);
  }
  const result: MatchPlayerLaneRoles = new Map();
  for (const player of players) {
    if (!player.steamid) continue;
    const role = classifyLaneFromCoordinates(
      samplesBySlot.get(`${player.match_id}\u0000${player.slot}`) ?? [],
      player.team
    );
    if (!role) continue;
    const byPlayer = result.get(player.match_id) ?? new Map<string, LaneRole>();
    byPlayer.set(player.steamid, role);
    result.set(player.match_id, byPlayer);
  }
  return result;
}

async function fetchCoordinateSamples(
  conn: mysql.Connection,
  table: "player_intervals2" | "hero_status_update",
  matchIds: string[],
  startTime: number,
  endTime: number
): Promise<CoordinateSample[]> {
  const placeholders = finitePlaceholders(matchIds);
  const [rawRows] = await conn.query(
    `SELECT match_id, slot, log_index, x, y
     FROM ${ANALYSIS_SCHEMA}.${table}
     WHERE match_id IN (${placeholders})
       AND time BETWEEN ? AND ?
       AND MOD(time, 10) = 0`,
    [...matchIds, startTime, endTime]
  );
  const deduped = new Map<string, CoordinateSample>();
  for (const raw of rawRows as Array<Record<string, unknown>>) {
    const matchId = String(raw.match_id ?? "").trim();
    const slot = Number(raw.slot);
    const logIndex = Number(raw.log_index);
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (
      !matchId ||
      !Number.isInteger(slot) ||
      !Number.isFinite(logIndex) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }
    deduped.set(`${matchId}\u0000${logIndex}`, {
      match_id: matchId,
      slot,
      log_index: logIndex,
      x,
      y,
    });
  }
  return [...deduped.values()];
}

// 拉取某联赛的逐场选手明细。DWD 缺失时依次使用 OpenDota、STRATZ、两类原始坐标。
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
      lane_source: "dwd" as const,
    }));
    if (positionRows.length > 0) return positionRows;

    const [matchRowsRaw] = await conn.query(
      `SELECT match_id, radiant_team_id, radiant_team_tag, dire_team_id, dire_team_tag
       FROM ${ANALYSIS_SCHEMA}.match_info
       WHERE league_id = ?`,
      [leagueId]
    );
    const matches = new Map<string, MatchSideRow>();
    for (const raw of matchRowsRaw as Array<Record<string, unknown>>) {
      const matchId = String(raw.match_id ?? "").trim();
      if (!matchId) continue;
      matches.set(matchId, {
        match_id: matchId,
        radiant_team_id: String(raw.radiant_team_id ?? "").trim(),
        radiant_team_tag: String(raw.radiant_team_tag ?? "").trim(),
        dire_team_id: String(raw.dire_team_id ?? "").trim(),
        dire_team_tag: String(raw.dire_team_tag ?? "").trim(),
      });
    }
    const matchIds = [...matches.keys()];
    if (matchIds.length === 0) return [];
    const placeholders = finitePlaceholders(matchIds);

    const [playerRowsRaw] = await conn.query(
      `SELECT match_id, slot, steamid, persona, team
       FROM ${ANALYSIS_SCHEMA}.players
       WHERE match_id IN (${placeholders})`,
      matchIds
    );
    const playersBySlot = new Map<string, Record<string, unknown>>();
    for (const raw of playerRowsRaw as Array<Record<string, unknown>>) {
      const matchId = String(raw.match_id ?? "").trim();
      const slot = Number(raw.slot);
      if (matchId && Number.isInteger(slot)) playersBySlot.set(`${matchId}\u0000${slot}`, raw);
    }

    const steamids = [
      ...new Set(
        [...playersBySlot.values()]
          .map((row) => String(row.steamid ?? "").trim())
          .filter(Boolean)
      ),
    ];
    const proNames = new Map<string, string>();
    if (steamids.length > 0) {
      const [proRowsRaw] = await conn.query(
        `SELECT steamid, name
         FROM ${ANALYSIS_SCHEMA}.pro_players
         WHERE steamid IN (${steamids.map(() => "?").join(",")})`,
        steamids
      );
      for (const raw of proRowsRaw as Array<Record<string, unknown>>) {
        const steamid = String(raw.steamid ?? "").trim();
        const name = String(raw.name ?? "").trim();
        if (steamid && name && !proNames.has(steamid)) proNames.set(steamid, name);
      }
    }

    const [hitRowsRaw] = await conn.query(
      `SELECT match_id, time, slot, log_index, lh
       FROM ${ANALYSIS_SCHEMA}.player_intervals2
       WHERE match_id IN (${placeholders})
         AND time BETWEEN 240 AND 360`,
      matchIds
    );
    const hitRows = new Map<string, Record<string, unknown>>();
    for (const raw of hitRowsRaw as Array<Record<string, unknown>>) {
      const matchId = String(raw.match_id ?? "").trim();
      const logIndex = Number(raw.log_index);
      if (matchId && Number.isFinite(logIndex)) {
        hitRows.set(`${matchId}\u0000${logIndex}`, raw);
      }
    }
    const hitsAtFive = new Map<string, { distance: number; value: number }>();
    for (const raw of hitRows.values()) {
      const matchId = String(raw.match_id ?? "").trim();
      const slot = Number(raw.slot);
      const time = Number(raw.time);
      const value = Number(raw.lh);
      if (!matchId || !Number.isInteger(slot) || !Number.isFinite(time) || !Number.isFinite(value)) {
        continue;
      }
      const key = `${matchId}\u0000${slot}`;
      const distance = Math.abs(time - 300);
      const current = hitsAtFive.get(key);
      if (!current || distance < current.distance) hitsAtFive.set(key, { distance, value });
    }

    const baseRows: BasePlayerRow[] = [];
    for (const raw of playersBySlot.values()) {
      const matchId = String(raw.match_id ?? "").trim();
      const match = matches.get(matchId);
      const steamid = String(raw.steamid ?? "").trim();
      const slot = Number(raw.slot);
      const team = Number(raw.team);
      if (!match || !steamid || !Number.isInteger(slot) || (team !== 2 && team !== 3)) continue;
      baseRows.push({
        match_id: matchId,
        team,
        team_name: mapTeamName(match, team),
        steamid,
        name: proNames.get(steamid) || String(raw.persona ?? "").trim() || steamid,
        hits_5m: hitsAtFive.get(`${matchId}\u0000${slot}`)?.value ?? null,
        lane_role: null,
        slot,
        lane_source: null,
      });
    }

    const lanes = new Map<
      string,
      { role: LaneRole; source: LeaguePlayerRow["lane_source"] }
    >();
    mergeLaneRoles(lanes, await fetchOpenDotaLaneRoles(matchIds), "opendota");

    let missingMatchIds = matchesMissingLanes(baseRows, lanes);
    if (missingMatchIds.length > 0) {
      mergeLaneRoles(lanes, await fetchStratzLaneRoles(missingMatchIds), "stratz");
    }

    missingMatchIds = matchesMissingLanes(baseRows, lanes);
    if (missingMatchIds.length > 0) {
      const intervalSamples = await fetchCoordinateSamples(
        conn,
        "player_intervals2",
        missingMatchIds,
        60,
        300
      );
      mergeLaneRoles(
        lanes,
        coordinateRoles(
          intervalSamples,
          baseRows.filter((row) => missingMatchIds.includes(row.match_id))
        ),
        "intervals"
      );
    }

    missingMatchIds = matchesMissingLanes(baseRows, lanes);
    if (missingMatchIds.length > 0) {
      const heroSamples = await fetchCoordinateSamples(
        conn,
        "hero_status_update",
        missingMatchIds,
        60,
        300
      );
      mergeLaneRoles(
        lanes,
        coordinateRoles(
          heroSamples,
          baseRows.filter((row) => missingMatchIds.includes(row.match_id))
        ),
        "hero_status"
      );
    }

    return baseRows.map((row) => {
      const lane = row.steamid ? lanes.get(`${row.match_id}\u0000${row.steamid}`) : null;
      return {
        team_name: row.team_name,
        steamid: row.steamid,
        name: row.name,
        hits_5m: row.hits_5m,
        lane_role: lane?.role ?? null,
        slot: row.slot,
        lane_source: lane?.source ?? null,
      };
    });
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

/**
 * 返回同一联赛内、同一队名标签且完整五人阵容一致时关联的全部 team_id。
 * key 格式：`${normalized_team_tag}\0${sorted_steamids.join(",")}`。
 *
 * 读取后分别按 match_id 与 (match_id, slot) 在内存中去重，避免重复上传的
 * 比赛或选手记录影响阵容比对结果。
 */
export async function fetchLeagueSameRosterTeamIds(
  leagueId: string
): Promise<Map<string, string[]>> {
  return withConnection(async (conn) => {
    const [matchRows] = await conn.query(
      `SELECT match_id, radiant_team_id, radiant_team_tag, dire_team_id, dire_team_tag
       FROM ${ANALYSIS_SCHEMA}.match_info
       WHERE league_id = ?`,
      [leagueId]
    );

    const matchesById = new Map<string, Record<string, unknown>>();
    for (const row of matchRows as Array<Record<string, unknown>>) {
      const matchId = String(row.match_id ?? "").trim();
      if (matchId) matchesById.set(matchId, row);
    }
    const matchIds = Array.from(matchesById.keys());
    if (matchIds.length === 0) return new Map();

    const placeholders = matchIds.map(() => "?").join(",");
    const [playerRows] = await conn.query(
      `SELECT match_id, slot, steamid, team
       FROM ${ANALYSIS_SCHEMA}.players
       WHERE match_id IN (${placeholders})`,
      matchIds
    );

    const playersByMatchSide = new Map<string, string[]>();
    const seenPlayerSlots = new Set<string>();
    for (const row of playerRows as Array<Record<string, unknown>>) {
      const matchId = String(row.match_id ?? "").trim();
      const slot = Number(row.slot);
      const team = Number(row.team);
      const steamid = String(row.steamid ?? "").trim();
      const slotKey = `${matchId}\u0000${slot}`;
      if (!matchId || !steamid || (team !== 2 && team !== 3) || seenPlayerSlots.has(slotKey)) {
        continue;
      }
      seenPlayerSlots.add(slotKey);
      const sideKey = `${matchId}\u0000${team}`;
      const roster = playersByMatchSide.get(sideKey) ?? [];
      roster.push(steamid);
      playersByMatchSide.set(sideKey, roster);
    }

    const teamIdsByRoster = new Map<string, Set<string>>();
    for (const [matchId, match] of matchesById.entries()) {
      for (const [side, idField, tagField] of [
        [2, "radiant_team_id", "radiant_team_tag"],
        [3, "dire_team_id", "dire_team_tag"],
      ] as const) {
        const teamId = String(match[idField] ?? "").trim();
        const tag = String(match[tagField] ?? "").trim();
        const roster = playersByMatchSide.get(`${matchId}\u0000${side}`) ?? [];
        const uniqueRoster = Array.from(new Set(roster)).sort();
        if (!teamId || teamId === "0" || !tag || uniqueRoster.length !== 5) continue;

        const key = `${tag.toLocaleLowerCase()}\u0000${uniqueRoster.join(",")}`;
        const ids = teamIdsByRoster.get(key) ?? new Set<string>();
        ids.add(teamId);
        teamIdsByRoster.set(key, ids);
      }
    }

    const result = new Map<string, string[]>();
    for (const [key, ids] of teamIdsByRoster.entries()) {
      if (ids.size > 1) result.set(key, Array.from(ids).sort());
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
    // 维表没有名称时用 OpenDota 兜底
    const fromOpenDota = await fetchOpenDotaLeagueName(leagueId);
    return fromOpenDota || null;
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
