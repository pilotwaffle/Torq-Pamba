import { publicBase } from "@/lib/platform/authserver";
import { handleMcp } from "@/lib/platform/mcp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcp(request, publicBase(request));
}

/** Stateless server: no server-initiated SSE stream and no sessions to delete. */
export async function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
