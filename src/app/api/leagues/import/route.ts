import { NextRequest, NextResponse } from "next/server";
import { fetchLeagueName, fetchLeaguePlayerRows, fetchLeagueTeams } from "@/lib/starrocks";
import { importLeagueFromRawRows, type LeagueImportResult } from "@/lib/local-store";

export const dynamic = "force-dynamic";

interface ImportBody {
  league_ids?: unknown;
}

// POST /api/leagues/import  body: { league_ids: string[] }
// 对每个联赛从 StarRocks 拉取比赛明细，启发式重建阵容并合并进本地库
export async function POST(req: NextRequest) {
  let body: ImportBody;
  try {
    body = (await req.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const rawIds = body.league_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "请至少选择一个联赛" }, { status: 400 });
  }

  const leagueIds = Array.from(
    new Set(rawIds.map((v) => String(v).trim()).filter(Boolean))
  );

  const results: LeagueImportResult[] = [];
  const errors: Array<{ league_id: string; error: string }> = [];

  for (const leagueId of leagueIds) {
    try {
      const [leagueName, rows, teams] = await Promise.all([
        fetchLeagueName(leagueId),
        fetchLeaguePlayerRows(leagueId),
        fetchLeagueTeams(leagueId),
      ]);
      const result = importLeagueFromRawRows(
        leagueId,
        leagueName ?? `League ${leagueId}`,
        rows,
        teams
      );
      results.push(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "未知错误";
      errors.push({ league_id: leagueId, error: message });
    }
  }

  return NextResponse.json({
    imported_leagues: results.length,
    imported_teams: results.reduce((sum, r) => sum + r.teams_imported, 0),
    results,
    errors,
  });
}
