import { NextRequest, NextResponse } from "next/server";
import { fetchTeamInfo, fetchTeamInfos } from "@/lib/teamid-detect";

export const dynamic = "force-dynamic";

// GET /api/team-id/team-logo?team_id=X  或  ?ids=a,b,c
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get("ids");
  try {
    if (ids) {
      const list = ids.split(",").map((s) => s.trim()).filter(Boolean);
      const logos = await fetchTeamInfos(list);
      return NextResponse.json({ logos });
    }
    const teamId = (searchParams.get("team_id") ?? "").trim();
    const info = await fetchTeamInfo(teamId);
    return NextResponse.json(info);
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `获取队徽失败: ${message}` }, { status: 500 });
  }
}
