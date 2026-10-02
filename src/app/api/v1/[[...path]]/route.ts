import { handleRest } from "@/lib/platform/rest";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return handleRest(request, (await params).path ?? []);
}

export async function POST(request: Request, { params }: Context) {
  return handleRest(request, (await params).path ?? []);
}
