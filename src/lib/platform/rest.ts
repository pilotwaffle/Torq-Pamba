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
 * REST API v1. Auth: `X-API-Key: tpk_...` (or `Authorization: Bearer` with an
 * API key or OAuth access token). JSON in, JSON out, errors as
 * `{ "error": { "code", "message" } }`.
 */

type Route = {
  method: "GET" | "POST";
  pattern: RegExp;
  operation: string;
  run: (principal: Principal, match: RegExpMatchArray, body: unknown, url: URL) => Promise<OperationResult>;
};

const ROUTES: Route[] = [
  { method: "GET", pattern: /^me$/, operation: "me", run: (p) => getWorkspaceInfo(p) },
  {
    method: "GET",
    pattern: /^videos$/,
    operation: "videos.list",
    run: (p, _m, _b, url) => listVideosOp(p, { limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined }),
  },
  { method: "POST", pattern: /^videos$/, operation: "videos.create", run: (p, _m, body) => createVideoOp(p, body) },
  { method: "GET", pattern: /^videos\/([^/]+)$/, operation: "videos.get", run: (p, m) => getVideoOp(p, { id: m[1] }) },
  { method: "POST", pattern: /^estimate$/, operation: "estimate", run: (p, _m, body) => estimateOp(p, body) },
  { method: "GET", pattern: /^schedule$/, operation: "schedule.list", run: (p) => listScheduleOp(p) },
  { method: "GET", pattern: /^analytics$/, operation: "analytics", run: (p) => analyticsOp(p) },
  { method: "GET", pattern: /^knowledge$/, operation: "knowledge", run: (p) => knowledgeOp(p) },
];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message } }, headers);
}

export async function handleRest(request: Request, segments: string[]): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = segments.map((part) => decodeURIComponent(part)).join("/");
  const candidates = ROUTES.filter((route) => route.pattern.test(path));
  if (candidates.length === 0) return errorResponse(404, "not_found", `No endpoint ${method} /api/v1/${path}`);
  const route = candidates.find((candidate) => candidate.method === method);
  if (!route) return errorResponse(405, "method_not_allowed", `Use ${candidates.map((c) => c.method).join(" or ")}`, { allow: candidates.map((c) => c.method).join(", ") });

  const secret = bearerFrom(request.headers);
  if (!secret) return errorResponse(401, "unauthorized", "Send an API key in the X-API-Key header", { "www-authenticate": 'Bearer realm="torq-pamba"' });
  const principal = await authenticate(secret);
  if (!principal) return errorResponse(401, "unauthorized", "API key is invalid, expired, or revoked", { "www-authenticate": 'Bearer realm="torq-pamba", error="invalid_token"' });
  if (await rateLimited(principal.grantId)) return errorResponse(429, "rate_limited", "Too many requests. Try again in a minute.", { "retry-after": "60" });

  let body: unknown = {};
  if (method === "POST") {
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        await recordRequest({ principal, surface: "rest", operation: route.operation, status: 400 });
        return errorResponse(400, "invalid_json", "Body must be JSON");
      }
    }
  }
  try {
    const result = await route.run(principal, path.match(route.pattern)!, body, new URL(request.url));
    const status = result.status ?? 200;
    await recordRequest({ principal, surface: "rest", operation: route.operation, status, costUsd: result.costUsd });
    return json(status, { data: result.data });
  } catch (error) {
    if (error instanceof ApiError) {
      // Failed calls never carry a cost.
      await recordRequest({ principal, surface: "rest", operation: route.operation, status: error.status });
      return errorResponse(error.status, error.code, error.message);
    }
    await recordRequest({ principal, surface: "rest", operation: route.operation, status: 500 });
    return errorResponse(500, "internal_error", "Something went wrong. Nothing was charged.");
  }
}
