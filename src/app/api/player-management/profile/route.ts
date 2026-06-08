import { NextRequest, NextResponse } from "next/server";
import {
  getPlayerProfileBySteamid64,
  movePlayerPositionWithSwap,
  updatePlayerNicknameBySteamid64,
} from "@/lib/local-store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const steamid64 = (searchParams.get("steamid64") ?? "").trim();
  if (!/^\d{17}$/.test(steamid64)) {
    return NextResponse.json({ error: "请输入有效的 17 位 SteamID64" }, { status: 400 });
  }
  const profile = getPlayerProfileBySteamid64(steamid64);
  if (!profile) {
    return NextResponse.json({ error: "未找到该选手" }, { status: 404 });
  }
  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const action = body?.action;

  if (action === "update_nickname") {
    const steamid64 = String(body?.steamid64 ?? "").trim();
    const nickname = String(body?.nickname ?? "").trim();
    if (!/^\d{17}$/.test(steamid64)) {
      return NextResponse.json({ error: "请输入有效的 17 位 SteamID64" }, { status: 400 });
    }
    if (!nickname) {
      return NextResponse.json({ error: "昵称不能为空" }, { status: 400 });
    }
    const result = updatePlayerNicknameBySteamid64(steamid64, nickname);
    if (result.updated_count === 0) {
      return NextResponse.json({ error: "未找到该选手" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  }

  if (action === "update_position") {
    const playerId = Number(body?.player_id);
    const targetPosition = Number(body?.target_position);
    if (!playerId) {
      return NextResponse.json({ error: "player_id 无效" }, { status: 400 });
    }
    if (![1, 2, 3, 4, 5].includes(targetPosition)) {
      return NextResponse.json({ error: "位置必须是 1~5 号位" }, { status: 400 });
    }
    const result = movePlayerPositionWithSwap(playerId, targetPosition);
    if (!result.moved) {
      return NextResponse.json({ error: "位置更新失败，未找到选手" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...result });
  }

  return NextResponse.json({ error: "未知 action" }, { status: 400 });
}
