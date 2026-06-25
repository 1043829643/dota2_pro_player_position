import { readFileSync } from "fs";
import path from "path";
import { getClient } from "../src/storage/database/supabase-client";

type CsvRow = Record<string, string>;

interface TournamentRecord {
  id: number;
  name: string;
  league_id: string;
}

interface TeamRecord {
  id: number;
  tournament_id: number;
  name: string;
  team_id: string | null;
}

const client = getClient();

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      "请提供 CSV 路径，例如：pnpm import:lineups ../team_player_info_starting_lineup_with_names_v3.csv"
    );
  }

  const csvPath = path.resolve(process.cwd(), inputPath);
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  if (rows.length === 0) {
    throw new Error("CSV 没有可导入的数据");
  }

  let importedTeams = 0;
  let importedPlayers = 0;

  for (const row of rows) {
    const leagueId = required(row, "league_id");
    const leagueName = required(row, "league_name");
    const externalTeamId = required(row, "team_id");
    const teamName = required(row, "team_name");
    const teamTag = row.team_tag || null;

    const tournament = await findOrCreateTournament(leagueId, leagueName);
    const team = await findOrCreateTeam(
      tournament.id,
      externalTeamId,
      teamName,
      teamTag
    );

    await replaceTeamPlayers(team.id, row);
    importedTeams += 1;
    importedPlayers += 5;
  }

  console.log(`导入完成：${importedTeams} 支战队，${importedPlayers} 名选手`);
}

async function findOrCreateTournament(
  leagueId: string,
  leagueName: string
): Promise<TournamentRecord> {
  const { data: existing, error: findError } = await client
    .from("tournaments")
    .select("id, name, league_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (existing) {
    const { data, error } = await client
      .from("tournaments")
      .update({ name: leagueName, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("id, name, league_id")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await client
    .from("tournaments")
    .insert({ name: leagueName, league_id: leagueId })
    .select("id, name, league_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function findOrCreateTeam(
  tournamentId: number,
  externalTeamId: string,
  teamName: string,
  teamTag: string | null
): Promise<TeamRecord> {
  const { data: existing, error: findError } = await client
    .from("teams")
    .select("id, tournament_id, name, team_id")
    .eq("tournament_id", tournamentId)
    .eq("team_id", externalTeamId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (existing) {
    const { data, error } = await client
      .from("teams")
      .update({
        name: teamName,
        short_name: teamTag,
        status: "完整",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, tournament_id, name, team_id")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await client
    .from("teams")
    .insert({
      tournament_id: tournamentId,
      name: teamName,
      short_name: teamTag,
      team_id: externalTeamId,
      status: "完整",
    })
    .select("id, tournament_id, name, team_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function replaceTeamPlayers(teamId: number, row: CsvRow) {
  const { error: deleteError } = await client
    .from("players")
    .delete()
    .eq("team_id", teamId);
  if (deleteError) throw new Error(deleteError.message);

  const players = [1, 2, 3, 4, 5].map((position) => {
    const nickname = required(row, `pos${position}_nickname`);
    const steamid64 = required(row, `pos${position}_steamid`);
    if (!/^\d{17}$/.test(steamid64)) {
      throw new Error(`${nickname} 的 steamid64 格式错误：${steamid64}`);
    }
    return {
      team_id: teamId,
      nickname,
      steamid64,
      position,
    };
  });

  const { error: insertError } = await client.from("players").insert(players);
  if (insertError) throw new Error(insertError.message);
}

function required(row: CsvRow, key: string): string {
  const value = row[key]?.trim();
  if (!value) throw new Error(`CSV 缺少必填字段：${key}`);
  return value;
}

function parseCsv(content: string): CsvRow[] {
  const lines = parseCsvRows(content);
  const [headers, ...records] = lines;
  if (!headers) return [];

  return records
    .filter((record) => record.some((value) => value.trim() !== ""))
    .map((record) =>
      Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]))
    );
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`导入失败：${message}`);
  process.exit(1);
});
