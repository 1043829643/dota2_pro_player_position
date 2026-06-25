import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/storage/database/supabase-client";

export const dynamic = "force-dynamic";

const STEAMID64_BASE = BigInt("76561197960265728");

function steamid64ToStratzUrl(steamid64: string): string {
  try {
    const accountId = BigInt(steamid64) - STEAMID64_BASE;
    return `https://stratz.com/players/${accountId}`;
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  try {
    const client = getClient();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "all";
    const tournamentId = searchParams.get("id");

    let tournamentFilter = {};
    if (scope === "tournament" && tournamentId) {
      tournamentFilter = { tournament_id: parseInt(tournamentId) };
    }

    const { data: tournamentList, error: tErr } = await client
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });

    if (tErr) throw tErr;

    let filteredTournaments = tournamentList || [];
    if (scope === "tournament" && tournamentId) {
      filteredTournaments = filteredTournaments.filter(
        (t) => t.id === parseInt(tournamentId)
      );
    }

    const rows: string[][] = [];

    for (const tournament of filteredTournaments) {
      const { data: teamList } = await client
        .from("teams")
        .select("*")
        .eq("tournament_id", tournament.id)
        .order("name");

      for (const team of teamList || []) {
        const { data: playerList } = await client
          .from("players")
          .select("*")
          .eq("team_id", team.id)
          .order("position");

        const posMap: Record<number, { nickname: string; steamid64: string }> = {};
        for (const p of playerList || []) {
          posMap[p.position] = { nickname: p.nickname, steamid64: p.steamid64 };
        }

        for (let pos = 1; pos <= 5; pos++) {
          const player = posMap[pos];
          const nickname = player?.nickname || "";
          const steamid64 = player?.steamid64 || "";
          const stratzUrl = steamid64 ? steamid64ToStratzUrl(steamid64) : "";

          rows.push([
            tournament.name,
            tournament.league_id,
            team.name,
            team.team_id || "",
            nickname,
            `${pos}号位`,
            steamid64,
            stratzUrl,
          ]);
        }
      }
    }

    const header = "比赛名,league_id,战队名,team_id,选手昵称,位置,steamid64,STRATZ链接";
    const csv = [header, ...rows.map((r) => r.join(","))].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="roster-export.csv"',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
