import { NextResponse } from "next/server";
import { listPlayerAppearanceCards } from "@/lib/local-store";

export async function GET() {
  const cards = listPlayerAppearanceCards();
  const seen = new Set<string>();
  const player_order: string[] = [];
  for (const card of cards) {
    if (!seen.has(card.steamid64)) {
      seen.add(card.steamid64);
      player_order.push(card.steamid64);
    }
  }
  return NextResponse.json({ cards, player_order });
}
