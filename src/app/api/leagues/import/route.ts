import { NextRequest, NextResponse } from "next/server";
import {
  fetchLeagueName,
  fetchLeaguePlayerRows,
  fetchLeagueTeams,
  fetchLeagueTeamExternalIds,
  fetchLeagueMatchDateRange,
  type LeaguePlayerRow,
  type LeagueTeamRow,
} from "@/lib/starrocks";
import { importLeagueFromRawRows, type LeagueImportResult, dedupeAllTournamentsInStore } from "@/lib/local-store";
import { fetchTeamInfos } from "@/lib/teamid-detect";

export const dynamic = "force-dynamic";

interface ImportBody {
  league_ids?: unknown;
}

/** overview 队名缺失时 SQL 会回退为 team_id 字符串，这里用官方 API 还原为真实队名 */
async function hydrateNumericTeamNames(
  rows: LeaguePlayerRow[],
  teams: LeagueTeamRow[],
  externalIds: Map<string, string>
): Promise<void> {
  const numericIds = new Set<string>();
  const collect = (name: string | null | undefined) => {
    const n = (name ?? "").trim();
    if (/^\d{4,10}$/.test(n)) numericIds.add(n);
  };
  for (const r of rows) collect(r.team_name);
  for (const t of teams) collect(t.team_name);
  for (const name of externalIds.keys()) collect(name);

  if (numericIds.size === 0) return;

  const infos = await fetchTeamInfos([...numericIds]);
  const idToName = new Map<string, string>();
  for (const id of numericIds) {
    const info = infos[id];
    const label = (info?.name || info?.tag || "").trim();
    if (label) idToName.set(id, label);
  }
  if (idToName.size === 0) return;

  for (const r of rows) {
    const n = (r.team_name ?? "").trim();
    if (idToName.has(n)) r.team_name = idToName.get(n)!;
  }
  for (const t of teams) {
    const n = t.team_name.trim();
    if (idToName.has(n)) t.team_name = idToName.get(n)!;
  }
  for (const [key, tid] of [...externalIds.entries()]) {
    if (idToName.has(key)) {
      externalIds.delete(key);
      externalIds.set(idToName.get(key)!, tid);
    }
  }
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
      const [leagueName, rows, teams, externalIds, matchDates] = await Promise.all([
        fetchLeagueName(leagueId),
        fetchLeaguePlayerRows(leagueId),
        fetchLeagueTeams(leagueId),
        fetchLeagueTeamExternalIds(leagueId),
        fetchLeagueMatchDateRange(leagueId),
      ]);
      await hydrateNumericTeamNames(rows, teams, externalIds);
      const teamsWithIds = teams.map((t) => ({
        ...t,
        team_id: externalIds.get(t.team_name) ?? null,
      }));
      const result = importLeagueFromRawRows(
        leagueId,
        leagueName ?? `League ${leagueId}`,
        rows,
        teamsWithIds,
        matchDates
      );
      results.push(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "未知错误";
      errors.push({ league_id: leagueId, error: message });
    }
  }

  const dedupeAll = dedupeAllTournamentsInStore();

  return NextResponse.json({
    imported_leagues: results.length,
    imported_teams: results.reduce((sum, r) => sum + r.teams_imported, 0),
    results,
    errors,
    deduped_all_teams: dedupeAll.removed,
  });
}
