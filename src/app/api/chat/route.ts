import { z } from "zod";
import { handleUserMessage } from "@/lib/agent/run";
import { jsonError, ndjsonStream, sameOrigin } from "@/lib/agent/stream";
import { readSession } from "@/lib/auth/session";
import { getWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const body = z.object({
  text: z.string().trim().min(1).max(4000),
  conversationId: z.uuid().optional(),
});

/** Sends a chat message and streams the agent's turn as NDJSON `AgentEvent` lines. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError(403, "Forbidden");
  const session = await readSession();
  if (!session) return jsonError(401, "Sign in first");
  const current = await getWorkspaceForUser(session.user.id);
  if (!current) return jsonError(401, "No workspace");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Write a message");

  return ndjsonStream(async (emit) => {
    await handleUserMessage({
      workspace: current.workspace,
      userId: session.user.id,
      text: parsed.data.text,
      conversationId: parsed.data.conversationId,
      emit,
    });
  });
}
