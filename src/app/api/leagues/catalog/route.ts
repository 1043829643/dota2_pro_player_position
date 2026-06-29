import { NextResponse } from "next/server";
import { listAllLeagues } from "@/lib/starrocks";
import { getExistingLeagueIds } from "@/lib/local-store";

export const dynamic = "force-dynamic";

// GET /api/leagues/catalog
// 返回 StarRocks 中所有联赛，并标记是否已导入本地库
export async function GET() {
  try {
    const [leagues, existing] = await Promise.all([
      listAllLeagues(),
      Promise.resolve(getExistingLeagueIds()),
    ]);
    const data = leagues.map((l) => ({
      ...l,
      already_added: existing.has(String(l.league_id)),
    }));
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json(
      { error: `读取联赛列表失败: ${message}` },
      { status: 500 }
    );
  }
}
