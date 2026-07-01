import { NextRequest, NextResponse } from "next/server";
import {
  deleteTournamentById,
  getTournamentById,
  updateTournamentById,
} from "@/lib/local-store";

// GET /api/tournaments/[id] - 获取单场比赛
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = getTournamentById(Number(id));
  if (!data) {
    return NextResponse.json({ error: "比赛不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}

// PUT /api/tournaments/[id] - 更新比赛（名称 / league_id / 标签）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, league_id, event_tier } = body;

  if (event_tier !== undefined && String(event_tier).trim() === "") {
    return NextResponse.json({ error: "event_tier 不能为空" }, { status: 400 });
  }

  const data = updateTournamentById(Number(id), {
    name,
    league_id,
    event_tier: event_tier === undefined ? undefined : String(event_tier).trim(),
  });
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
  const { id } = await params;
  const deleted = deleteTournamentById(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "比赛不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}