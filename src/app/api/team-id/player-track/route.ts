import { NextRequest, NextResponse } from "next/server";
import { trackPlayer } from "@/lib/teamid-detect";

export const dynamic = "force-dynamic";

// POST /api/team-id/player-track  body: { steamid, start_time?, end_time? }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const steamid = String(body.steamid ?? "").trim();
  if (!/^\d+$/.test(steamid)) {
    return NextResponse.json({ error: "请输入有效的 steamid（纯数字）" }, { status: 400 });
  }

  try {
    const result = await trackPlayer(steamid, {
      startTime: body.start_time ? String(body.start_time).trim() : null,
      endTime: body.end_time ? String(body.end_time).trim() : null,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `追踪失败: ${message}` }, { status: 500 });
  }
}
