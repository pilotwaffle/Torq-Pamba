import { handleTokenRequest } from "@/lib/platform/authserver";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleTokenRequest(request);
}
