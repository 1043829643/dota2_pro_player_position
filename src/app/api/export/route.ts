import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const client = getSupabaseClient();

// GET /api/export?scope=tournament&id=1 或 /api/export?scope=all
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") ?? "all";
  const tournamentId = searchParams.get("id");

  let tournaments: any[] = [];

  if (scope === "tournament" && tournamentId) {
    const { data, error } = await client
      .from("tournaments")
      .select("*")
      .eq("id", Number(tournamentId));
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    tournaments = data ?? [];
  } else {
    const { data, error } = await client
      .from("tournaments")
      .select("*")
      .order("name");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    tournaments = data ?? [];
  }

  // 构建 CSV 行
  const rows: string[] = [
    "比赛名,league_id,战队名,team_id,选手昵称,位置,steamid64,STRATZ链接",
  ];

  for (const t of tournaments) {
    const { data: teams } = await client
      .from("teams")
      .select("*")
      .eq("tournament_id", t.id)
      .order("name");

    for (const team of teams ?? []) {
      const { data: players } = await client
        .from("players")
        .select("*")
        .eq("team_id", team.id)
        .order("position");

      if (players && players.length > 0) {
        for (const p of players) {
          const stratzLink = p.steamid64
            ? `https://stratz.com/player/${p.steamid64}`
            : "";
          rows.push(
            [
              escapeCsv(t.name),
              escapeCsv(t.league_id),
              escapeCsv(team.name),
              escapeCsv(team.team_id ?? ""),
              escapeCsv(p.nickname),
              `${p.position}号位`,
              p.steamid64 ?? "",
              stratzLink,
            ].join(",")
          );
        }
      } else {
        // 战队无选手，仍输出一行
        rows.push(
          [
            escapeCsv(t.name),
            escapeCsv(t.league_id),
            escapeCsv(team.name),
            escapeCsv(team.team_id ?? ""),
            "",
            "",
            "",
            "",
          ].join(",")
        );
      }
    }
  }

  const csv = rows.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lineup-export-${Date.now()}.csv"`,
    },
  });
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}