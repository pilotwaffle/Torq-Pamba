import { authenticate, bearerFrom, rateLimited, recordRequest, type Principal } from "./credentials";
import {
  analyticsOp,
  ApiError,
  createVideoOp,
  estimateOp,
  getVideoOp,
  getWorkspaceInfo,
  knowledgeOp,
  listScheduleOp,
  listVideosOp,
  type OperationResult,
} from "./operations";

/**
 * Remote MCP server (Streamable HTTP transport, stateless, JSON responses only).
 * POST /api/mcp with JSON-RPC 2.0. Auth is a Bearer API key or an OAuth 2.1
 * access token; without one the server answers 401 with a WWW-Authenticate
 * header that points at the protected-resource metadata (RFC 9728), which is
 * how MCP clients discover the authorization server.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26"];

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write?: boolean;
  run: (principal: Principal, args: Record<string, unknown>) => Promise<OperationResult>;
};

const TIER_SCHEMA = { type: "string", enum: ["budget", "standard", "premium"], default: "standard" };

export const TOOLS: Tool[] = [
  {
    name: "get_workspace",
    title: "Workspace and budget",
    description: "Workspace name, plan, monthly budget left, and this credential's scope and monthly credit ceiling.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (p) => getWorkspaceInfo(p),
  },
  {
    name: "list_videos",
    title: "List videos",
    description: "Most recent videos in the workspace with status and tier.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, additionalProperties: false },
    run: (p, args) => listVideosOp(p, args),
  },
  {
    name: "get_video",
    title: "Get a video",
    description: "One video: hook, captions, cost, and its publish status on each platform.",
    inputSchema: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"], additionalProperties: false },
    run: (p, args) => getVideoOp(p, args),
  },
  {
    name: "estimate_video_cost",
    title: "Estimate a video's cost",
    description: "Itemized cost estimate for a clip of the given length and tier, plus the budget left this month.",
    inputSchema: {
      type: "object",
      properties: { durationS: { type: "integer", minimum: 6, maximum: 60, default: 30 }, tier: TIER_SCHEMA },
      additionalProperties: false,
    },
    run: (p, args) => estimateOp(p, args),
  },
  {
    name: "create_video",
    title: "Generate a video",
    description:
      "Plans and generates one UGC-style video from a prompt. Spends workspace budget (only on success). Needs a write credential. The video still needs human approval in the studio before it can be published.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 3, maxLength: 2000 },
        durationS: { type: "integer", minimum: 6, maximum: 60, default: 30 },
        tier: TIER_SCHEMA,
        hookIndex: { type: "integer", minimum: 0, maximum: 2, default: 0 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    write: true,
    run: (p, args) => createVideoOp(p, args),
  },
  {
    name: "list_schedule",
    title: "List the schedule",
    description: "Scheduled, publishing, and due-for-manual-posting items.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (p) => listScheduleOp(p),
  },
  {
    name: "get_analytics",
    title: "Post analytics",
    description: "Latest views, likes, comments, shares and engagement for posts made through official APIs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (p) => analyticsOp(p),
  },
  {
    name: "list_knowledge",
    title: "Brand knowledge",
    description: "Knowledge tiles: proven hooks from hook tests, angles, audience notes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (p) => knowledgeOp(p),
  },
];

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "content-type": "application/json" }), "cache-control": "no-store", ...headers },
  });
}

export function resourceMetadataUrl(base: string): string {
  return `${base}/.well-known/oauth-protected-resource/api/mcp`;
}

function toolList(principal: Principal) {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.write && principal.scope !== "write" ? `${tool.description} (Unavailable: this credential is read-only.)` : tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: !tool.write, destructiveHint: false, openWorldHint: Boolean(tool.write) },
  }));
}

async function callTool(principal: Principal, params: Record<string, unknown> | undefined) {
  const name = typeof params?.name === "string" ? params.name : "";
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${name || "(none)"}` } };
  const args = params?.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
  try {
    const result = await tool.run(principal, args);
    await recordRequest({ principal, surface: "mcp", operation: tool.name, status: result.status ?? 200, costUsd: result.costUsd, credits: result.credits });
    return {
      result: {
        content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
        structuredContent: { data: result.data },
        isError: false,
      },
    };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    await recordRequest({ principal, surface: "mcp", operation: tool.name, status });
    const message = error instanceof ApiError ? `${error.code}: ${error.message}` : "internal_error: Something went wrong. Nothing was charged.";
    // Tool failures are results with isError, so the model can read and react to them.
    return { result: { content: [{ type: "text", text: message }], isError: true } };
  }
}

export async function handleMcp(request: Request, base: string): Promise<Response> {
  const secret = bearerFrom(request.headers);
  const challenge = { "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl(base)}"` };
  if (!secret) return respond(401, rpcError(null, -32001, "Authentication required"), challenge);
  const principal = await authenticate(secret);
  if (!principal) {
    return respond(401, rpcError(null, -32001, "Invalid or expired token"), {
      "www-authenticate": `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl(base)}"`,
    });
  }
  if (await rateLimited(principal.grantId)) return respond(429, rpcError(null, -32002, "Rate limited"), { "retry-after": "60" });

  let message: JsonRpcRequest;
  try {
    const parsed: unknown = JSON.parse(await request.text());
    if (Array.isArray(parsed)) return respond(400, rpcError(null, -32600, "Batch requests are not supported"));
    message = (parsed ?? {}) as JsonRpcRequest;
  } catch {
    return respond(400, rpcError(null, -32700, "Parse error"));
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return respond(400, rpcError(message.id, -32600, "Invalid request"));

  // Notifications and responses from the client get 202 Accepted with no body.
  if (message.id === undefined) return respond(202, null);

  switch (message.method) {
    case "initialize": {
      const requested = typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : MCP_PROTOCOL_VERSION;
      return respond(
        200,
        rpcResult(message.id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "torq-pamba", title: "Torq-Pamba", version: "0.4.0" },
          instructions:
            "Torq-Pamba makes short UGC-style videos. Estimate before generating. Generated videos need human approval in the studio before they can be scheduled or published; this server cannot approve or publish.",
        }),
      );
    }
    case "ping":
      return respond(200, rpcResult(message.id, {}));
    case "tools/list":
      return respond(200, rpcResult(message.id, { tools: toolList(principal) }));
    case "tools/call": {
      const outcome = await callTool(principal, message.params);
      return respond(200, "error" in outcome ? rpcError(message.id, outcome.error!.code, outcome.error!.message) : rpcResult(message.id, outcome.result));
    }
    default:
      return respond(200, rpcError(message.id, -32601, `Method not found: ${message.method}`));
  }
}
