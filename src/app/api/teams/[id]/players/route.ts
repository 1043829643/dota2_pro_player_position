import { NextRequest, NextResponse } from "next/server";
<<<<<<< HEAD
import {
  addPlayerToTeam,
  findPlayerByTeamAndPosition,
  listPlayersByTeamId,
} from "@/lib/local-store";
=======
import { getClient } from "@/storage/database/supabase-client";
>>>>>>> aa4d265 (fix: 修复部署构建时 COZE_SUPABASE_URL 未设置导致 build 失败的问题)

// GET /api/teams/[id]/players - 获取战队所有选手
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  return NextResponse.json(listPlayersByTeamId(Number(id)));
}

// POST /api/teams/[id]/players - 为战队添加选手
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  const body = await req.json();
  const validationError = validateNewPlayerPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const position = Number(body.position);
  const occupied = findPlayerByTeamAndPosition(Number(id), position);
  if (occupied) {
    return NextResponse.json(
      { error: `${position}号位 已有选手「${occupied.nickname}」` },
      { status: 400 }
    );
  }
  const data = addPlayerToTeam(Number(id), {
    nickname: String(body.nickname).trim(),
    steamid64: body.steamid64 ? String(body.steamid64) : null,
    position,
  });
  return NextResponse.json(data, { status: 201 });
}

function validateNewPlayerPayload(body: Record<string, unknown>): string | null {
  if (typeof body.nickname !== "string" || body.nickname.trim().length === 0) {
    return "昵称不能为空";
  }

  if (
    body.steamid64 &&
    (typeof body.steamid64 !== "string" || !/^\d{17}$/.test(body.steamid64))
  ) {
    return "steamid64 格式错误（需为 17 位数字）";
  }

  if (![1, 2, 3, 4, 5].includes(Number(body.position))) {
    return "位置必须是 1~5 号位";
  }

  return null;
}