import { NextRequest, NextResponse } from "next/server";
import {
  createTeamInTournament,
  listTeamsByTournamentId,
} from "@/lib/local-store";

// GET /api/tournaments/[id]/teams - 获取比赛下所有战队及阵容摘要
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json(listTeamsByTournamentId(Number(id)));
}

// POST /api/tournaments/[id]/teams - 在比赛下创建战队
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "战队名不能为空" }, { status: 400 });
  }
  const data = createTeamInTournament(Number(id), {
    name: String(body.name).trim(),
    short_name: body.short_name ? String(body.short_name) : null,
    team_id: body.team_id ? String(body.team_id) : null,
  });
  return NextResponse.json(data, { status: 201 });
}