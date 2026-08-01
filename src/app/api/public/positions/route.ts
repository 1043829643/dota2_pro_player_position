import { NextResponse } from "next/server";
import { listAllPositions } from "@/lib/local-store";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// GET /api/public/positions
// 公开只读：一次性返回全量「联赛 → 战队 → 1~5 号位选手」数据，无需鉴权。
export function GET() {
  const data = listAllPositions();
  return NextResponse.json(data, { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
