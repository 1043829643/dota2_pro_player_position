import { NextRequest, NextResponse } from "next/server";
import { detectSameRoster, type DetectionMode } from "@/lib/teamid-detect";

export const dynamic = "force-dynamic";

// POST /api/team-id/detect
// body: { detection_mode, max_diff, league_id?, start_time?, end_time?, limit? }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const mode: DetectionMode =
    body.detection_mode === "cross_league" ? "cross_league" : "same_league";

  let maxDiff = Number(body.max_diff ?? 0);
  if (![0, 1, 2].includes(maxDiff)) maxDiff = 0;

  let limit: number | null = null;
  if (body.limit !== undefined && body.limit !== null && String(body.limit).trim() !== "") {
    const n = Number(body.limit);
    if (Number.isNaN(n)) {
      return NextResponse.json({ error: "limit 必须是数字" }, { status: 400 });
    }
    limit = n;
  }

  try {
    const rows = await detectSameRoster({
      mode,
      maxDiff: maxDiff as 0 | 1 | 2,
      leagueId: body.league_id ? String(body.league_id).trim() : null,
      startTime: body.start_time ? String(body.start_time).trim() : null,
      endTime: body.end_time ? String(body.end_time).trim() : null,
      limit,
    });
    return NextResponse.json({ rows, count: rows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `检测失败: ${message}` }, { status: 500 });
  }
}
