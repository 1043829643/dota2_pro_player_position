import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/storage/database/supabase-client";
import { tournaments, teams, players } from "@/storage/database/shared/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = getClient();
    const { data: tournamentList, error } = await client
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const summaries = await Promise.all(
      (tournamentList || []).map(async (t) => {
        const { data: teamList } = await client
          .from("teams")
          .select("id")
          .eq("tournament_id", t.id);

        const teamIds = (teamList || []).map((tm) => tm.id);
        let filledPositions = 0;

        if (teamIds.length > 0) {
          const { data: playerList } = await client
            .from("players")
            .select("team_id, position")
            .in("team_id", teamIds);
          const uniquePositions = new Set(
            (playerList || []).map((p) => `${p.team_id}-${p.position}`)
          );
          filledPositions = uniquePositions.size;
        }

        const totalPositions = (teamList || []).length * 5;

        return {
          id: t.id,
          name: t.name,
          league_id: t.league_id,
          teams_count: (teamList || []).length,
          completion: `${filledPositions}/${totalPositions}`,
          updated_at: t.updated_at,
        };
      })
    );

    return NextResponse.json(summaries);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = getClient();
    const body = await request.json();
    const { data, error } = await client
      .from("tournaments")
      .insert({ name: body.name, league_id: body.league_id })
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
