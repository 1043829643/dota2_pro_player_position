import { NextRequest, NextResponse } from "next/server";
import { searchPlayerCandidates } from "@/lib/teamid-detect";

export const dynamic = "force-dynamic";

// GET /api/team-id/player-candidates?q=名字
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ candidates: [] });
  try {
    const candidates = await searchPlayerCandidates(q);
    return NextResponse.json({ candidates });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `搜索失败: ${message}` }, { status: 500 });
  }
}
