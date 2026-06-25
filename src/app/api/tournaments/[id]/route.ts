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
      .from("tournaments")
      .select("*")
      .eq("id", parseInt(id))
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "比赛不存在" }, { status: 404 });
      }
      throw error;
    }
    return NextResponse.json(data);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getClient();
    const { id } = await params;
    const body = await request.json();
    const { data, error } = await client
      .from("tournaments")
      .update({ name: body.name, league_id: body.league_id, updated_at: new Date().toISOString() })
      .eq("id", parseInt(id))
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getClient();
    const { id } = await params;
    const { error } = await client
      .from("tournaments")
      .delete()
      .eq("id", parseInt(id));

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
