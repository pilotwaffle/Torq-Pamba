import { NextResponse } from "next/server";
import { handleCronTick } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleCronTick(request.headers.get("authorization"));
  return NextResponse.json(result.body, { status: result.status });
}
