import { NextResponse } from "next/server";
import { readManualRecords } from "@/lib/manual-records";

export const dynamic = "force-dynamic";

// GET /api/team-id/manual-records -> { records }
export async function GET() {
  try {
    const records = readManualRecords();
    return NextResponse.json({ records });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `读取维护表失败: ${message}` }, { status: 500 });
  }
}
