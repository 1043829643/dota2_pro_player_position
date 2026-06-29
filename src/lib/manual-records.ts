import fs from "fs";
import path from "path";

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
  return normalized;
}

function normalizeRecord(record: unknown): ManualRecord {
  const src = (record ?? {}) as Record<string, unknown>;
  const out = {} as ManualRecord;
  for (const field of MANUAL_RECORD_FIELDS) {
    out[field] = src[field] == null ? "" : String(src[field]);
  }
  return out;
}
