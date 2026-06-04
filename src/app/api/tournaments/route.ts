import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const client = getSupabaseClient();

// GET /api/tournaments - 获取所有比赛列表
export async function GET() {
  // 先获取所有比赛
  const { data: tournamentsData, error: tourError } = await client
    .from("tournaments")
    .select("id, name, league_id, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (tourError) {
    return NextResponse.json({ error: tourError.message }, { status: 500 });
  }

  // 为每场比赛统计战队数和选手数
  const result = await Promise.all(
    (tournamentsData ?? []).map(async (t) => {
      const { data: teamsData } = await client
        .from("teams")
        .select("id")
        .eq("tournament_id", t.id);

      const teamIds = (teamsData ?? []).map((x) => x.id);
      const teamsCount = teamIds.length;

      let completion = "0/0";
      if (teamsCount > 0) {
        const { count } = await client
          .from("players")
          .select("*", { count: "exact", head: true })
          .in("team_id", teamIds);

        const totalSlots = teamsCount * 5;
        const filledSlots = count ?? 0;
        completion = `${Math.min(filledSlots, totalSlots)}/${totalSlots}`;
      }

      return {
        id: t.id,
        name: t.name,
        league_id: t.league_id,
        teams_count: teamsCount,
        completion,
        updated_at: t.updated_at,
      };
    })
  );

  return NextResponse.json(result);
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

  const { data, error } = await client
    .from("tournaments")
    .insert({ name, league_id })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}