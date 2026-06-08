import { NextRequest, NextResponse } from "next/server";
import {
  deleteTeamById,
  getTeamById,
  updateTeamById,
} from "@/lib/local-store";

// GET /api/teams/[id] - 获取单支战队
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const team = getTeamById(Number(id));
  if (!team) {
    return NextResponse.json({ error: "战队不存在" }, { status: 404 });
  }
  return NextResponse.json(team);
}

// PUT /api/teams/[id] - 更新战队
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data = updateTeamById(Number(id), {
    name: body.name,
    short_name: body.short_name,
    team_id: body.team_id,
    status: body.status,
  });
  if (!data) {
    return NextResponse.json({ error: "战队不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}

// DELETE /api/teams/[id] - 删除战队
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteTeamById(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "战队不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}