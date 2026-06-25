import { NextRequest, NextResponse } from "next/server";
<<<<<<< HEAD
import { deletePlayerById, updatePlayerById } from "@/lib/local-store";
=======
import { getClient } from "@/storage/database/supabase-client";
>>>>>>> aa4d265 (fix: 修复部署构建时 COZE_SUPABASE_URL 未设置导致 build 失败的问题)

// PUT /api/players/[id] - 更新选手
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  const body = await req.json();
  const validationError = validatePlayerPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  const data = updatePlayerById(Number(id), {
    nickname:
      body.nickname !== undefined ? String(body.nickname).trim() : undefined,
    steamid64:
      body.steamid64 !== undefined
        ? body.steamid64
          ? String(body.steamid64)
          : null
        : undefined,
    position: body.position !== undefined ? Number(body.position) : undefined,
  });
  if (!data) {
    return NextResponse.json({ error: "选手不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}

// DELETE /api/players/[id] - 删除选手
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  const deleted = deletePlayerById(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "选手不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

function validatePlayerPayload(body: Record<string, unknown>): string | null {
  if (
    typeof body.nickname === "string" &&
    body.nickname.trim().length === 0
  ) {
    return "昵称不能为空";
  }

  if (
    body.steamid64 &&
    (typeof body.steamid64 !== "string" || !/^\d{17}$/.test(body.steamid64))
  ) {
    return "steamid64 格式错误（需为 17 位数字）";
  }

  if (
    body.position !== undefined &&
    (![1, 2, 3, 4, 5].includes(Number(body.position)))
  ) {
    return "位置必须是 1~5 号位";
  }

  return null;
}