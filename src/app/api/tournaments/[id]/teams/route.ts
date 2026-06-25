import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/storage/database/supabase-client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getClient();
    const { id } = await params;
    const tournamentId = parseInt(id);

    const { data: teamList, error } = await client
      .from("teams")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("name");

    if (error) throw error;

    const teamsWithPlayers = await Promise.all(
      (teamList || []).map(async (team) => {
        const { data: playerList } = await client
          .from("players")
          .select("*")
          .eq("team_id", team.id)
          .order("position");

        const summary = (playerList || [])
          .map((p) => `${p.nickname}(${p.position}号位)`)
          .join(", ");

        return { ...team, players: playerList || [], summary };
      })
    );

    return NextResponse.json(teamsWithPlayers);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getClient();
    const { id } = await params;
    const body = await request.json();
    const { data, error } = await client
      .from("teams")
      .insert({
        tournament_id: parseInt(id),
        name: body.name,
        short_name: body.short_name,
        team_id: body.team_id,
        status: "缺失",
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
