import { NextRequest, NextResponse } from "next/server";
import {
  createTeamInTournament,
  getTournamentById,
  listTeamsByTournamentId,
} from "@/lib/local-store";
import { fetchLeagueSameRosterTeamIds } from "@/lib/starrocks";

// GET /api/tournaments/[id]/teams - 获取比赛下所有战队及阵容摘要
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const teams = listTeamsByTournamentId(Number(id));
  const tournament = getTournamentById(Number(id));
  if (!tournament?.league_id) return NextResponse.json(teams);

  try {
    const idsByRoster = await fetchLeagueSameRosterTeamIds(tournament.league_id);
    const enriched = teams.map((team) => {
      const steamids = Array.from(
        new Set(
          team.players
            .map((player) => player.steamid64?.trim())
            .filter((steamid): steamid is string => Boolean(steamid))
        )
      ).sort();
      const tag = (team.short_name ?? team.name).trim().toLocaleLowerCase();
      const rosterKey = `${tag}\u0000${steamids.join(",")}`;
      const teamIds = idsByRoster.get(rosterKey);
      if (!teamIds) return team;
      const primaryId = team.team_id?.trim();
      const orderedTeamIds =
        primaryId && teamIds.includes(primaryId)
          ? [primaryId, ...teamIds.filter((teamId) => teamId !== primaryId)]
          : teamIds;
      return { ...team, team_ids: orderedTeamIds };
    });
    return NextResponse.json(enriched);
  } catch (error) {
    console.error("[tournament teams] failed to resolve related team IDs:", error);
    // 数据库暂时不可用时仍返回本地阵容，避免列表页不可用。
    return NextResponse.json(teams);
  }
}

// POST /api/tournaments/[id]/teams - 在比赛下创建战队
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "战队名不能为空" }, { status: 400 });
  }
  const data = createTeamInTournament(Number(id), {
    name: String(body.name).trim(),
    short_name: body.short_name ? String(body.short_name) : null,
    team_id: body.team_id ? String(body.team_id) : null,
  });
  return NextResponse.json(data, { status: 201 });
}