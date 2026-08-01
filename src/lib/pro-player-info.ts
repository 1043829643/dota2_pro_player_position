// 选手名解析：数据源为 Dota2 官方 Fantasy 接口 GetProPlayerInfo/v001。
// 该接口返回全部职业选手的规范名（以及战队、真名、国籍、队徽等），
// 用 account_id(32 位) + 76561197960265728 换算为 steamid64，与本地库/数据库对齐。
// 目的：不再用数据库里的当场游戏名（常含临时改名/表情/口号），统一用官方规范名。

const PRO_PLAYER_INFO_URL =
  "https://www.dota2.com/webapi/IDOTA2Fantasy/GetProPlayerInfo/v001";

// steamid64 = account_id + STEAMID64_BASE
const STEAMID64_BASE = BigInt("76561197960265728");

export interface ProPlayerInfo {
  steamid64: string;
  account_id: number;
  name: string;
  team_id: string;
  team_tag: string;
  real_name: string;
  country_code: string;
  team_url_logo: string;
}

interface RawProPlayer {
  account_id?: number;
  name?: string;
  team_id?: number;
  team_tag?: string;
  real_name?: string;
  country_code?: string;
  team_url_logo?: string;
}

// 模块级缓存：steamid64 -> 规范信息
const INFO_BY_STEAMID = new Map<string, ProPlayerInfo>();
let lastLoadedAt = 0;
let loadingPromise: Promise<void> | null = null;

// 缓存有效期：6 小时
const TTL_MS = 6 * 60 * 60 * 1000;

function accountIdToSteamId64(accountId: number): string {
  return String(BigInt(accountId) + STEAMID64_BASE);
}

async function fetchAndPopulate(): Promise<void> {
  const res = await fetch(PRO_PLAYER_INFO_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`GetProPlayerInfo 返回 ${res.status}`);
  }
  const data = (await res.json()) as { player_infos?: RawProPlayer[] };
  const list = data.player_infos ?? [];
  INFO_BY_STEAMID.clear();
  for (const p of list) {
    if (p.account_id == null) continue;
    const name = String(p.name ?? "").trim();
    if (!name) continue;
    const steamid64 = accountIdToSteamId64(p.account_id);
    INFO_BY_STEAMID.set(steamid64, {
      steamid64,
      account_id: p.account_id,
      name,
      team_id: p.team_id == null ? "" : String(p.team_id),
      team_tag: String(p.team_tag ?? "").trim(),
      real_name: String(p.real_name ?? "").trim(),
      country_code: String(p.country_code ?? "").trim(),
      team_url_logo: String(p.team_url_logo ?? "").trim(),
    });
  }
  lastLoadedAt = Date.now();
}

/** 确保选手信息已加载（带 TTL 缓存）。force=true 时强制刷新。并发调用共享同一次请求。 */
export async function ensureProPlayerInfoLoaded(force = false): Promise<number> {
  const stale = Date.now() - lastLoadedAt > TTL_MS;
  if (!force && INFO_BY_STEAMID.size > 0 && !stale) {
    return INFO_BY_STEAMID.size;
  }
  if (loadingPromise) {
    await loadingPromise;
    return INFO_BY_STEAMID.size;
  }
  loadingPromise = fetchAndPopulate().finally(() => {
    loadingPromise = null;
  });
  try {
    await loadingPromise;
  } catch (e) {
    // 拉取失败时保留旧缓存（可能为空），不抛断导入流程
    console.error("[pro-player-info] 拉取失败:", e);
  }
  return INFO_BY_STEAMID.size;
}

/** 同步查询规范名（需先 ensureProPlayerInfoLoaded）。查不到返回 null。 */
export function getProPlayerName(steamid64: string | null | undefined): string | null {
  const sid = (steamid64 ?? "").trim();
  if (!sid) return null;
  return INFO_BY_STEAMID.get(sid)?.name ?? null;
}

/** 同步查询完整规范信息。 */
export function getProPlayerInfo(
  steamid64: string | null | undefined
): ProPlayerInfo | null {
  const sid = (steamid64 ?? "").trim();
  if (!sid) return null;
  return INFO_BY_STEAMID.get(sid) ?? null;
}

export function getProPlayerInfoCacheSize(): number {
  return INFO_BY_STEAMID.size;
}
