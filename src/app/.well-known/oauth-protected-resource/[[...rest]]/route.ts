import { protectedResourceMetadata, publicBase } from "@/lib/platform/authserver";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(protectedResourceMetadata(publicBase(request)), { headers: { "access-control-allow-origin": "*" } });
}
