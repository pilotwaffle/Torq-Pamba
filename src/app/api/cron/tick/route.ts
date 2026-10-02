import { NextResponse } from "next/server";
import { processJobs } from "@/lib/jobs/worker";
import { handleCronTick } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleCronTick(request.headers.get("authorization"));
  if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });
  // Same secret, same tick: also move every due clip and render job one step.
  const jobs = await processJobs();
  return NextResponse.json({ ...result.body, jobs }, { status: result.status });
}
