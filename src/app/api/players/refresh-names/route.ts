import { NextResponse } from "next/server";
import { refreshAllPlayerNamesFromProApi } from "@/lib/local-store";

export const dynamic = "force-dynamic";

// POST /api/players/refresh-names
// 用 Dota2 官方规范名回填本地库中所有历史比赛的选手名（按 steamid64 匹配）。
export async function POST() {
  try {
    const result = await refreshAllPlayerNamesFromProApi();
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json(
      { error: `刷新选手名失败: ${message}` },
      { status: 500 }
    );
  }
}
