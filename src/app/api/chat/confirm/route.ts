import { z } from "zod";
import { resolveToolCall } from "@/lib/agent/loop";
import { resolveAgentModel } from "@/lib/agent/model";
import { jsonError, ndjsonStream, sameOrigin } from "@/lib/agent/stream";
import { readSession } from "@/lib/auth/session";
import { getWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const body = z.object({
  toolCallId: z.uuid(),
  decision: z.enum(["confirm", "reject"]),
  acknowledged: z.array(z.string().max(300)).max(10).default([]),
});

/** Confirms or declines a tool call that waits in the chat, then streams the rest of the turn. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError(403, "Forbidden");
  const session = await readSession();
  if (!session) return jsonError(401, "Sign in first");
  const current = await getWorkspaceForUser(session.user.id);
  if (!current) return jsonError(401, "No workspace");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid confirmation");

  return ndjsonStream(async (emit) => {
    const result = await resolveToolCall({
      workspace: current.workspace,
      userId: session.user.id,
      toolCallId: parsed.data.toolCallId,
      decision: parsed.data.decision,
      acknowledged: parsed.data.acknowledged,
      model: resolveAgentModel(),
      emit,
    });
    if (!result.ok) {
      emit({ type: "error", message: result.error });
      emit({ type: "done", paused: false });
    }
  });
}
