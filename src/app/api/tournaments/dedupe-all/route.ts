import { NextResponse } from "next/server";
import { dedupeAllTournamentsInStore } from "@/lib/local-store";

export const dynamic = "force-dynamic";

// POST /api/tournaments/dedupe-all - 对所有联赛内的重复战队去重
export async function POST() {
  const result = dedupeAllTournamentsInStore();
  return NextResponse.json({
    tournaments: result.tournaments,
    removed: result.removed,
  });
}
