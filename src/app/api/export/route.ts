import { NextRequest, NextResponse } from "next/server";
import { exportRowsWithTier } from "@/lib/local-store";
const STEAMID64_BASE = BigInt("76561197960265728");

// GET /api/export?scope=tournament&id=1 或 /api/export?scope=all
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") ?? "all";
  const tier = searchParams.get("tier") ?? "all";
  const tournamentIdRaw = searchParams.get("id");
  const tournamentId =
    scope === "tournament" && tournamentIdRaw ? Number(tournamentIdRaw) : undefined;

  // 构建 CSV 行
  const rows: string[] = [
    "比赛名,league_id,战队名,team_id,选手昵称,位置,steamid64,STRATZ链接",
  ];
  const exportData = exportRowsWithTier(
    scope === "tournament" ? "tournament" : "all",
    tournamentId,
    tier === "top" ? "top" : tier === "qualifier" ? "qualifier" : "all"
  );
  for (const row of exportData) {
    const stratzLink = row.player ? getStratzLink(row.player.steamid64) : "";
    rows.push(
      [
        escapeCsv(row.tournament.name),
        escapeCsv(row.tournament.league_id),
        escapeCsv(row.team.name),
        escapeCsv(row.team.team_id ?? ""),
        escapeCsv(row.player?.nickname ?? ""),
        row.player ? `${row.player.position}号位` : "",
        row.player?.steamid64 ?? "",
        stratzLink,
      ].join(",")
    );
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

function getStratzLink(steamid64: string | null): string {
  if (!steamid64 || !/^\d{17}$/.test(steamid64)) return "";
  const accountId = BigInt(steamid64) - STEAMID64_BASE;
  if (accountId <= BigInt(0)) return "";
  return `https://stratz.com/players/${accountId.toString()}`;
}