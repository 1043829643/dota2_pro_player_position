import { NextRequest, NextResponse } from "next/server";
import {
  createTournament,
  listTournamentSummaries,
} from "@/lib/local-store";

// GET /api/tournaments - 获取所有比赛列表
export async function GET() {
  return NextResponse.json(listTournamentSummaries());
}

// POST /api/tournaments - 创建比赛
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, league_id } = body;

  if (!name || !league_id) {
    return NextResponse.json(
      { error: "比赛名和联赛标识不能为空" },
      { status: 400 }
    );
  }

  const data = createTournament(name, league_id);
  return NextResponse.json(data, { status: 201 });
}