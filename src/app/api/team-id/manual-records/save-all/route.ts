import { NextRequest, NextResponse } from "next/server";
import { writeManualRecords, type ManualRecord } from "@/lib/manual-records";

export const dynamic = "force-dynamic";

// POST /api/team-id/manual-records/save-all
// body: { records: ManualRecord[] }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const incoming = body.records;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "需要 records 数组" }, { status: 400 });
  }

  try {
    const records = writeManualRecords(incoming as ManualRecord[]);
    return NextResponse.json({ records });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `保存维护表失败: ${message}` }, { status: 500 });
  }
}
