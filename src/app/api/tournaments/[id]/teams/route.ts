import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const client = getSupabaseClient();

// GET /api/tournaments/[id]/teams - 获取比赛下所有战队及阵容摘要
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: teams, error } = await client
    .from("teams")
    .select("*")
    .eq("tournament_id", Number(id))
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 为每个战队查询选手信息
  const result = await Promise.all(
    (teams ?? []).map(async (team: any) => {
      const { data: players } = await client
        .from("players")
        .select("*")
        .eq("team_id", team.id)
        .order("position");

      const playerList = (players ?? []) as any[];
      const positions = playerList.map((p) => p.position).sort();
      const positionSet = new Set(positions);

      let status = "缺失";
      if (playerList.length === 5 && positionSet.size === 5) {
        status = "完整";
      } else if (positionSet.size < playerList.length) {
        status = "重复";
      } else if (playerList.length > 0 && playerList.length < 5) {
        status = "缺失";
      }

      const summary = playerList
        .map((p) => `${p.nickname}(${p.position}号位)`)
        .join("、");

      return {
        ...team,
        players: playerList,
        summary,
        status,
      };
    })
  );

  return NextResponse.json(result);
}

// POST /api/tournaments/[id]/teams - 在比赛下创建战队
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const { data, error } = await client
    .from("teams")
    .insert({ ...body, tournament_id: Number(id) })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}