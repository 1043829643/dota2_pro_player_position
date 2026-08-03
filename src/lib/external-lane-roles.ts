const STEAMID64_BASE = BigInt("76561197960265728");
const OPENDOTA_MATCH_URL = "https://api.opendota.com/api/matches/";
const STRATZ_GRAPHQL_URL = "https://api.stratz.com/graphql";

export type LaneRole = 1 | 2 | 3 | 4 | 5;
export type MatchPlayerLaneRoles = Map<string, Map<string, LaneRole>>;

interface OpenDotaPlayer {
  account_id?: number | null;
  lane_role?: number | null;
}

interface OpenDotaMatch {
  players?: OpenDotaPlayer[];
}

interface StratzPlayer {
  steamAccountId?: number | null;
  laneRole?: unknown;
}

interface StratzResponse {
  data?: {
    match?: {
      players?: StratzPlayer[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

function accountIdToSteamId64(accountId: number): string {
  return String(BigInt(accountId) + STEAMID64_BASE);
}

function normalizeLaneRole(value: unknown): LaneRole | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) {
    return value as LaneRole;
  }
  const raw = String(value ?? "").trim().toUpperCase();
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric as LaneRole;
  }
  const names: Record<string, LaneRole> = {
    SAFE: 1,
    SAFE_LANE: 1,
    MID: 2,
    MID_LANE: 2,
    OFF: 3,
    OFF_LANE: 3,
    JUNGLE: 4,
    ROAMING: 5,
    ROAM: 5,
  };
  return names[raw] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return (await response.json()) as T;
      if (response.status !== 429 && response.status < 500) return null;
    } catch {
      // 网络失败或超时：按退避间隔重试，最终交给下一数据源。
    }
    if (attempt + 1 < attempts) await sleep(1000 * 2 ** attempt);
  }
  return null;
}

/** 从 OpenDota 单场详情依次读取 lane_role。无 key 时按公共限速串行请求。 */
export async function fetchOpenDotaLaneRoles(
  matchIds: string[]
): Promise<MatchPlayerLaneRoles> {
  const result: MatchPlayerLaneRoles = new Map();
  const apiKey = (process.env.OPENDOTA_API_KEY ?? "").trim();
  const intervalMs = apiKey ? 150 : 1050;

  for (let index = 0; index < matchIds.length; index += 1) {
    const matchId = matchIds[index];
    const suffix = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : "";
    const data = await fetchJsonWithRetry<OpenDotaMatch>(
      `${OPENDOTA_MATCH_URL}${matchId}${suffix}`,
      { headers: { "User-Agent": "dota2-position-importer/1.0" } }
    );
    const lanes = new Map<string, LaneRole>();
    for (const player of data?.players ?? []) {
      if (player.account_id == null) continue;
      const laneRole = normalizeLaneRole(player.lane_role);
      if (!laneRole) continue;
      lanes.set(accountIdToSteamId64(player.account_id), laneRole);
    }
    if (lanes.size > 0) result.set(matchId, lanes);
    if (index + 1 < matchIds.length) await sleep(intervalMs);
  }
  return result;
}

const STRATZ_MATCH_QUERY = `
  query MatchLaneRoles($matchId: Long!) {
    match(id: $matchId) {
      players {
        steamAccountId
        laneRole
      }
    }
  }
`;

/** 使用 STRATZ 补 OpenDota 未返回的比赛；未配置 STRATZ_API_TOKEN 时安全跳过。 */
export async function fetchStratzLaneRoles(
  matchIds: string[]
): Promise<MatchPlayerLaneRoles> {
  const token = (process.env.STRATZ_API_TOKEN ?? "").trim();
  const result: MatchPlayerLaneRoles = new Map();
  if (!token) return result;

  for (const matchId of matchIds) {
    const data = await fetchJsonWithRetry<StratzResponse>(STRATZ_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "dota2-position-importer/1.0",
      },
      body: JSON.stringify({
        query: STRATZ_MATCH_QUERY,
        variables: { matchId },
      }),
    });
    if (data?.errors?.length) continue;
    const lanes = new Map<string, LaneRole>();
    for (const player of data?.data?.match?.players ?? []) {
      if (player.steamAccountId == null) continue;
      const laneRole = normalizeLaneRole(player.laneRole);
      if (!laneRole) continue;
      lanes.set(accountIdToSteamId64(player.steamAccountId), laneRole);
    }
    if (lanes.size > 0) result.set(matchId, lanes);
  }
  return result;
}
