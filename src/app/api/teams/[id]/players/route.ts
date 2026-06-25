import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/storage/database/supabase-client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getClient();
    const { id } = await params;
    const { data, error } = await client
      .from("players")
      .select("*")
      .eq("team_id", parseInt(id))
      .order("position");

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getClient();
    const { id } = await params;
    const body = await request.json();
    const { data, error } = await client
      .from("players")
      .insert({
        team_id: parseInt(id),
        nickname: body.nickname,
        steamid64: body.steamid64,
        position: body.position,
      })
      .select()
      .single();

    if (error) throw error;

    await client
      .from("teams")
      .update({ status: "待确认", updated_at: new Date().toISOString() })
      .eq("id", parseInt(id));

    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
