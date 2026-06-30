import fs from "fs";
import path from "path";
import { isBlobStoreEnabled, loadBlob, saveBlob } from "./blob-store";

const BLOB_KEY = "manual_records";

// 维护表（同一支真实队伍的多个 team_id 映射），由 Python 工具 manual_team_id_records.csv 移植而来。
// 字段顺序与原工具一致，本地以 JSON 持久化。
export interface ManualRecord {
  group_id: string;
  roster: string;
  league_id: string;
  league_name: string;
  team_id: string;
  team_name: string;
  team_logo: string;
  note: string;
}

export const MANUAL_RECORD_FIELDS: Array<keyof ManualRecord> = [
  "group_id",
  "roster",
  "league_id",
  "league_name",
  "team_id",
  "team_name",
  "team_logo",
  "note",
];

const STORE_PATH = path.resolve(process.cwd(), "data", "manual-records.json");

function ensureDataDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

export function readManualRecords(): ManualRecord[] {
  if (!fs.existsSync(STORE_PATH)) return [];
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map(normalizeRecord);
  } catch {
    return [];
  }
}

export function writeManualRecords(records: ManualRecord[]): ManualRecord[] {
  ensureDataDir();
  const normalized = records.map(normalizeRecord);
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  if (isBlobStoreEnabled()) void saveBlob(BLOB_KEY, normalized);
  return normalized;
}

// 启动时从远端 blob 拉取并落到本地文件；远端为空则用本地（种子）数据初始化远端。
let hydrated = false;
export async function hydrateManualRecords(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!isBlobStoreEnabled()) return;
  try {
    const remote = await loadBlob<ManualRecord[]>(BLOB_KEY);
    if (Array.isArray(remote)) {
      ensureDataDir();
      fs.writeFileSync(
        STORE_PATH,
        JSON.stringify(remote.map(normalizeRecord), null, 2),
        "utf-8"
      );
      console.log("[manual-records] 已从远端 blob 恢复数据");
    } else {
      const seed = readManualRecords();
      await saveBlob(BLOB_KEY, seed);
      console.log("[manual-records] 远端为空，已用本地种子数据初始化远端 blob");
    }
  } catch (e) {
    console.error("[manual-records] hydrate 失败，回退本地文件:", e);
  }
}

function normalizeRecord(record: unknown): ManualRecord {
  const src = (record ?? {}) as Record<string, unknown>;
  const out = {} as ManualRecord;
  for (const field of MANUAL_RECORD_FIELDS) {
    out[field] = src[field] == null ? "" : String(src[field]);
  }
  return out;
}
