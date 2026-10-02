import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { apiKeys, apiRequests, videos, workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { saveServiceRequest } from "@/lib/service";
import {
  authorizationServerMetadata,
  createAuthorizationCode,
  handleTokenRequest,
  protectedResourceMetadata,
  registerClient,
  s256,
  validateAuthorizeRequest,
} from "./authserver";
import {
  authenticate,
  createApiKey,
  creditsForUsd,
  grantSpendCredits,
  grantSpendUsd,
  hashSecret,
  issueOAuthTokens,
  rateLimited,
  revokeGrant,
} from "./credentials";
import { handleMcp } from "./mcp";
import { handleRest } from "./rest";

const BASE = "https://studio.example";
const password = "correct-horse-battery";
const email = (label: string) => `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

async function setup(label: string, budgetCapUsd = 25) {
  const { workspace, user } = await signupAccount({ email: email(label), password, workspaceName: `${label} Co` });
  const db = await getDb();
  await db.update(workspaces).set({ budgetCapUsd }).where(eq(workspaces.id, workspace.id));
  return { workspace, user, db };
}

function rest(path: string, key: string | null, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  const request = new Request(`${BASE}/api/v1/${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
  return handleRest(request, path.split("?")[0]!.split("/"));
}

function mcp(token: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  return handleMcp(new Request(`${BASE}/api/mcp`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), BASE);
}

describe("API keys", () => {
  it("shows the key once, stores only its hash, and authenticates until revoked", async () => {
    const { workspace, user, db } = await setup("key-basic");
    const { key, credential } = await createApiKey({ workspaceId: workspace.id, name: "CI", scope: "read", actor: user.id });
    expect(key).toMatch(/^tpk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(credential.prefix)).toBe(true);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, credential.id));
    expect(row!.keyHash).toBe(hashSecret(key));
    expect(row).toMatchObject({ kind: "key", prefix: credential.prefix, scopes: ["read"], readOnly: true, maxCredits: null, createdBy: user.id });
    // The secret is everything after "tpk_<8 hex>_" (base64url, so it may itself contain "_").
    const secretPart = key.slice(credential.prefix.length + 1);
    expect(secretPart).toHaveLength(43);
    expect(JSON.stringify(row)).not.toContain(secretPart);
    expect(await authenticate(key)).toMatchObject({ workspaceId: workspace.id, scope: "read", kind: "key", grantId: credential.id });
    expect(await authenticate(`${key.slice(0, -1)}x`)).toBeNull();
    expect(await authenticate("not-a-key")).toBeNull();
    await revokeGrant(workspace.id, credential.id, user.id);
    expect(await authenticate(key)).toBeNull();
  });

  it("rejects bad names and ceilings, and refresh tokens never authenticate a call", async () => {
    const { workspace, user, db } = await setup("key-validate");
    await expect(createApiKey({ workspaceId: workspace.id, name: " ", scope: "read", actor: user.id })).rejects.toThrow(/Name the key/);
    await expect(createApiKey({ workspaceId: workspace.id, name: "x", scope: "write", maxCredits: -1, actor: user.id })).rejects.toThrow(/Credit ceiling/);
    await expect(createApiKey({ workspaceId: workspace.id, name: "x", scope: "write", maxCredits: 1.5, actor: user.id })).rejects.toThrow(/Credit ceiling/);
    const tokens = await issueOAuthTokens({ workspaceId: workspace.id, clientId: "tpc_x", scope: "read", maxCredits: null, actor: user.id });
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.grantId, tokens.grantId));
    expect(rows.map((row) => row.kind).sort()).toEqual(["oauth_access", "oauth_refresh"]);
    expect(rows.every((row) => row.clientId === "tpc_x" && row.readOnly)).toBe(true);
    // A row that is not explicitly write is read, whatever its scopes say.
    await db.update(apiKeys).set({ scopes: ["read", "write"] }).where(eq(apiKeys.grantId, tokens.grantId));
    expect(await authenticate(tokens.accessToken)).toMatchObject({ scope: "read" });
    expect(await authenticate(tokens.refreshToken)).toBeNull();
    expect(await authenticate(tokens.accessToken)).toMatchObject({ kind: "oauth_access", clientId: "tpc_x" });
    const later = new Date(Date.now() + 2 * 3600 * 1000);
    expect(await authenticate(tokens.accessToken, later)).toBeNull();
  });
});

describe("REST /api/v1", () => {
  it("requires a valid key and returns the workspace with its budget", async () => {
    const { workspace, user } = await setup("rest-me");
    expect((await rest("me", null)).status).toBe(401);
    const bad = await rest("me", "tpk_00000000_" + "a".repeat(43));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain("invalid_token");
    const { key } = await createApiKey({ workspaceId: workspace.id, name: "read", scope: "read", actor: user.id });
    const me = await rest("me", key);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      data: { id: workspace.id, budget: { capUsd: 25, remainingUsd: 25 }, credential: { kind: "api_key", scope: "read", maxCredits: null, creditsUsedThisMonth: 0 } },
    });
    expect((await rest("nope", key)).status).toBe(404);
    expect((await rest("me", key, { method: "POST", body: {} })).status).toBe(405);
  });

  it("refuses generation with a read-only key and validates the body", async () => {
    const { workspace, user, db } = await setup("rest-scope");
    const read = await createApiKey({ workspaceId: workspace.id, name: "read", scope: "read", actor: user.id });
    const denied = await rest("videos", read.key, { method: "POST", body: { prompt: "30s video about cold brew" } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: "insufficient_scope", message: expect.stringContaining("read-only") } });
    const write = await createApiKey({ workspaceId: workspace.id, name: "write", scope: "write", actor: user.id });
    expect((await rest("videos", write.key, { method: "POST", body: "{not json" })).status).toBe(400);
    const invalid = await rest("videos", write.key, { method: "POST", body: { prompt: "x" } });
    expect(invalid.status).toBe(400);
    expect((await db.select().from(videos).where(eq(videos.workspaceId, workspace.id))).length).toBe(0);
  });

  it("generates with a write key, charges only the successful clip, and records the spend on the key", async () => {
    const { workspace, user } = await setup("rest-create");
    const write = await createApiKey({ workspaceId: workspace.id, name: "write", scope: "write", maxCredits: 2000, actor: user.id });
    const created = await rest("videos", write.key, { method: "POST", body: { prompt: "30s video about oat-milk cold brew", durationS: 30 } });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string; status: string; costUsd: number } };
    expect(body.data.status).toBe("ready");
    expect(body.data.costUsd).toBeGreaterThan(0);
    expect(await grantSpendUsd(write.credential.grantId)).toBe(body.data.costUsd);
    expect(await grantSpendCredits(write.credential.grantId)).toBe(creditsForUsd(body.data.costUsd));
    expect(await grantSpendCredits(write.credential.grantId)).toBeGreaterThan(0);
    const detail = await rest(`videos/${body.data.id}`, write.key);
    expect(await detail.json()).toMatchObject({ data: { id: body.data.id, status: "ready", aiGenerated: true, publishJobs: [] } });

    const refused = await rest("videos", write.key, { method: "POST", body: { prompt: "30s video about [refuse-all] things" } });
    expect(refused.status).toBe(422);
    expect(await grantSpendUsd(write.credential.grantId)).toBe(body.data.costUsd);
    const list = (await (await rest("videos?limit=5", write.key)).json()) as { data: { status: string }[] };
    expect(list.data.map((row) => row.status).sort()).toEqual(["failed", "ready"]);
  });

  it("returns 402 over the key's spending cap or the workspace budget, before any generation", async () => {
    const { workspace, user, db } = await setup("rest-402");
    const capped = await createApiKey({ workspaceId: workspace.id, name: "capped", scope: "write", maxCredits: 1, actor: user.id });
    const overCap = await rest("videos", capped.key, { method: "POST", body: { prompt: "30s video about cold brew" } });
    expect(overCap.status).toBe(402);
    expect(await overCap.json()).toMatchObject({ error: { code: "spend_cap_exceeded" } });
    const poor = await setup("rest-402-budget", 0);
    const key = await createApiKey({ workspaceId: poor.workspace.id, name: "w", scope: "write", actor: poor.user.id });
    const overBudget = await rest("videos", key.key, { method: "POST", body: { prompt: "30s video about cold brew" } });
    expect(overBudget.status).toBe(402);
    expect(await overBudget.json()).toMatchObject({ error: { code: "budget_exceeded" } });
    expect((await db.select().from(videos).where(eq(videos.workspaceId, workspace.id))).length).toBe(0);
    expect((await db.select().from(videos).where(eq(videos.workspaceId, poor.workspace.id))).length).toBe(0);
  });

  it("rate-limits a key at 120 requests a minute", async () => {
    const { workspace, user, db } = await setup("rest-rate");
    const { key, credential } = await createApiKey({ workspaceId: workspace.id, name: "busy", scope: "read", actor: user.id });
    await db.insert(apiRequests).values(
      Array.from({ length: 120 }, () => ({ workspaceId: workspace.id, grantId: credential.grantId, surface: "rest", operation: "me", status: 200 })),
    );
    expect(await rateLimited(credential.grantId)).toBe(true);
    const limited = await rest("me", key);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});

describe("MCP /api/mcp", () => {
  it("challenges unauthenticated clients with the protected-resource metadata URL", async () => {
    const response = await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it("initializes, lists tools, and answers notifications and unknown methods per JSON-RPC", async () => {
    const { workspace, user } = await setup("mcp-init");
    const { key } = await createApiKey({ workspaceId: workspace.id, name: "mcp", scope: "read", actor: user.id });
    const init = await mcp(key, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    expect(await init.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "torq-pamba" } },
    });
    expect((await mcp(key, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = (await (await mcp(key, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean } }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual([
      "get_workspace",
      "list_videos",
      "get_video",
      "estimate_video_cost",
      "create_video",
      "list_schedule",
      "get_analytics",
      "list_knowledge",
    ]);
    const create = list.result.tools.find((t) => t.name === "create_video")!;
    expect(create.annotations.readOnlyHint).toBe(false);
    expect(create.description).toContain("read-only");
    expect(await (await mcp(key, { jsonrpc: "2.0", id: 3, method: "resources/list" })).json()).toMatchObject({ error: { code: -32601 } });
    expect(await (await mcp(key, "{oops")).json()).toMatchObject({ error: { code: -32700 } });
    expect(await (await mcp(key, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } })).json()).toMatchObject({
      error: { code: -32602 },
    });
  });

  it("calls tools, returns scope and validation failures as isError results, and generates with a write grant", async () => {
    const { workspace, user } = await setup("mcp-call");
    const read = await createApiKey({ workspaceId: workspace.id, name: "r", scope: "read", actor: user.id });
    const estimate = (await (
      await mcp(read.key, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "estimate_video_cost", arguments: { durationS: 30 } } })
    ).json()) as { result: { isError: boolean; structuredContent: { data: { estimateUsd: { total: number } } } } };
    expect(estimate.result.isError).toBe(false);
    expect(estimate.result.structuredContent.data.estimateUsd.total).toBeGreaterThan(0);
    const denied = (await (
      await mcp(read.key, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_video", arguments: { prompt: "cold brew video" } } })
    ).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0]!.text).toMatch(/^insufficient_scope/);
    const bad = (await (
      await mcp(read.key, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_video", arguments: { id: "nope" } } })
    ).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(bad.result).toMatchObject({ isError: true, content: [{ text: "invalid_request: id must be a video id" }] });

    const tokens = await issueOAuthTokens({ workspaceId: workspace.id, clientId: "tpc_y", scope: "write", maxCredits: 1500, actor: user.id });
    const created = (await (
      await mcp(tokens.accessToken, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_video", arguments: { prompt: "30s video about cold brew" } } })
    ).json()) as { result: { isError: boolean; structuredContent: { data: { costUsd: number } } } };
    expect(created.result.isError).toBe(false);
    expect(await grantSpendUsd(tokens.grantId)).toBe(created.result.structuredContent.data.costUsd);
    expect(await grantSpendCredits(tokens.grantId)).toBe(creditsForUsd(created.result.structuredContent.data.costUsd));
  });
});

describe("OAuth 2.1 for MCP clients", () => {
  it("publishes authorization-server and protected-resource metadata", () => {
    expect(authorizationServerMetadata(BASE)).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/api/oauth2/token`,
      registration_endpoint: `${BASE}/api/oauth2/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(protectedResourceMetadata(BASE)).toEqual({
      resource: `${BASE}/api/mcp`,
      authorization_servers: [BASE],
      scopes_supported: ["read", "write"],
      bearer_methods_supported: ["header"],
      resource_name: "Torq-Pamba MCP",
    });
  });

  it("registers only https or loopback redirect URIs and validates authorization requests", async () => {
    await expect(registerClient({ redirect_uris: ["http://evil.example/cb"] })).rejects.toThrow(/https/);
    await expect(registerClient({ redirect_uris: [] })).rejects.toThrow(/1 to 5/);
    const client = await registerClient({ client_name: "Claude", redirect_uris: ["http://127.0.0.1:7777/cb", "https://app.example/cb"] });
    expect(client).toMatchObject({ client_name: "Claude", token_endpoint_auth_method: "none" });
    const challenge = s256("v".repeat(43));
    const good = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://app.example/cb",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "read write",
      state: "xyz",
      resource: `${BASE}/api/mcp`,
    });
    expect(await validateAuthorizeRequest(good, BASE)).toMatchObject({ clientName: "Claude", scope: "write", state: "xyz" });
    const variants: [Record<string, string>, RegExp][] = [
      [{ client_id: "tpc_unknown" }, /Unknown client_id/],
      [{ redirect_uri: "https://app.example/other" }, /not registered/],
      [{ code_challenge_method: "plain" }, /S256/],
      [{ code_challenge: "" }, /PKCE/],
      [{ scope: "admin" }, /scope/],
      [{ resource: "https://other.example/api/mcp" }, /resource/],
    ];
    for (const [patch, error] of variants) {
      const params = new URLSearchParams(good);
      for (const [k, v] of Object.entries(patch)) params.set(k, v);
      await expect(validateAuthorizeRequest(params, BASE)).rejects.toThrow(error);
    }
  });

  it("exchanges a code once with the right PKCE verifier, then rotates refresh tokens", async () => {
    const { workspace, user } = await setup("oauth-flow");
    const client = await registerClient({ client_name: "Cursor", redirect_uris: ["https://app.example/cb"] });
    const verifier = randomBytes(32).toString("base64url");
    const request = await validateAuthorizeRequest(
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://app.example/cb",
        response_type: "code",
        code_challenge: s256(verifier),
        code_challenge_method: "S256",
        scope: "write",
      }),
      BASE,
    );
    const code = await createAuthorizationCode({ request, workspaceId: workspace.id, userId: user.id, scope: "write", maxCredits: 500 });
    const token = (fields: Record<string, string>) =>
      handleTokenRequest(
        new Request(`${BASE}/api/oauth2/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields).toString(),
        }),
      );
    const base = { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: "https://app.example/cb" };
    const wrong = await token({ ...base, code_verifier: randomBytes(32).toString("base64url") });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: "invalid_grant", error_description: "PKCE verification failed" });
    expect(await (await token({ ...base, redirect_uri: "https://app.example/other", code_verifier: verifier })).json()).toMatchObject({ error: "invalid_grant" });
    const ok = await token({ ...base, code_verifier: verifier });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const issued = (await ok.json()) as { access_token: string; refresh_token: string; token_type: string; scope: string; expires_in: number };
    expect(issued).toMatchObject({ token_type: "Bearer", scope: "write", expires_in: 3600 });
    expect(await authenticate(issued.access_token)).toMatchObject({ scope: "write", maxCredits: 500, workspaceId: workspace.id });
    expect(await (await token({ ...base, code_verifier: verifier })).json()).toMatchObject({ error_description: "Authorization code was already used" });

    const refreshed = (await (
      await token({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: issued.refresh_token })
    ).json()) as { access_token: string; refresh_token: string };
    expect(await authenticate(refreshed.access_token)).toMatchObject({ scope: "write" });
    expect(await authenticate(issued.access_token)).toBeNull();
    const reused = await token({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: issued.refresh_token });
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    expect(await (await token({ grant_type: "password", client_id: client.client_id })).json()).toMatchObject({ error: "unsupported_grant_type" });
    expect((await token({ grant_type: "refresh_token", client_id: "tpc_nobody", refresh_token: "x" })).status).toBe(401);
  });

  it("stores done-with-you leads and silently drops honeypot submissions", async () => {
    const lead = { name: "Ada", email: "Ada@Northwind.example", company: "Northwind", monthlyVideos: 12, message: "Cold brew" };
    expect(await saveServiceRequest(lead)).toBe("stored");
    expect(await saveServiceRequest({ ...lead, website: "http://spam.example" })).toBe("dropped");
    await expect(saveServiceRequest({ ...lead, email: "bad" })).rejects.toThrow(/valid email/);
  });
});
