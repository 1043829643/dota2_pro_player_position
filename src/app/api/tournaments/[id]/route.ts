import { NextRequest, NextResponse } from "next/server";
<<<<<<< HEAD
import {
  deleteTournamentById,
  getTournamentById,
  updateTournamentById,
} from "@/lib/local-store";
=======
import { getClient } from "@/storage/database/supabase-client";
>>>>>>> aa4d265 (fix: 修复部署构建时 COZE_SUPABASE_URL 未设置导致 build 失败的问题)

// GET /api/tournaments/[id] - 获取单场比赛
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  const data = getTournamentById(Number(id));
  if (!data) {
    return NextResponse.json({ error: "比赛不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}

// PUT /api/tournaments/[id] - 更新比赛
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  const body = await req.json();
  const { name, league_id } = body;
  const data = updateTournamentById(Number(id), { name, league_id });
  if (!data) {
    return NextResponse.json({ error: "比赛不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}

// DELETE /api/tournaments/[id] - 删除比赛
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = getClient();
  const { id } = await params;
  const deleted = deleteTournamentById(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "比赛不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}