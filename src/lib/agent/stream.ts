import type { AgentEvent, EmitAgentEvent } from "@/lib/agent/events";

/**
 * Same-origin check for the chat endpoints. Browsers send `Origin` on every
 * POST from fetch; a request from another site's page is refused.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Runs `work` and streams its events as NDJSON. The work keeps going if the
 * browser disconnects, so a turn always finishes and is stored.
 */
export function ndjsonStream(work: (emit: EmitAgentEvent) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const emit = (event: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      work(emit)
        .catch((error: unknown) => {
          console.error("chat turn failed", error);
          emit({ type: "error", message: "Something went wrong in this turn. Your message was saved; try again." });
          emit({ type: "done", paused: false });
        })
        .finally(() => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // The client already went away.
          }
        });
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
