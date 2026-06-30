import { getSupabaseClient, loadEnv } from "../storage/database/supabase-client";

// 通用 blob 持久化：把整份 JSON 状态存到 Supabase 的 app_state 表，
// 用于在 Coze 等会重置文件系统的部署环境里持久化本地存储。
//
// 需要的表结构（在 Supabase SQL 编辑器执行一次）：
//   create table if not exists app_state (
//     key text primary key,
//     data jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//
// 未配置 Supabase 环境变量时，所有方法均为无操作 / 返回 null，
// 业务代码自动退回纯本地文件模式（本地开发即如此）。

const TABLE = "app_state";

function hasCreds(): boolean {
  const url = process.env.COZE_SUPABASE_URL;
  const key =
    process.env.COZE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.COZE_SUPABASE_ANON_KEY;
  return Boolean(url && key);
}

// 缓存判定结果：loadEnv 内部可能起 python 子进程探测 Coze 环境变量，只评估一次。
let enabledCache: boolean | null = null;
export function isBlobStoreEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  if (hasCreds()) {
    enabledCache = true;
    return true;
  }
  try {
    loadEnv();
  } catch {
    /* ignore */
  }
  enabledCache = hasCreds();
  return enabledCache;
}

// 读取某个 key 的 blob；不存在或未启用返回 null。
export async function loadBlob<T = unknown>(key: string): Promise<T | null> {
  if (!isBlobStoreEnabled()) return null;
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(TABLE)
      .select("data")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.error(`[blob-store] load ${key} 失败:`, error.message);
      return null;
    }
    if (!data) return null;
    return (data as { data: T }).data ?? null;
  } catch (e) {
    console.error(`[blob-store] load ${key} 异常:`, e);
    return null;
  }
}

// 整份写回某个 key 的 blob。
export async function saveBlob(key: string, value: unknown): Promise<void> {
  if (!isBlobStoreEnabled()) return;
  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from(TABLE)
      .upsert(
        { key, data: value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) {
      console.error(`[blob-store] save ${key} 失败:`, error.message);
    }
  } catch (e) {
    console.error(`[blob-store] save ${key} 异常:`, e);
  }
}
