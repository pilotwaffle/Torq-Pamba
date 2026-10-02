import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PASSWORD, signUp, uniqueEmail } from "./journey";

test("creates API keys, generates through REST and MCP within scope, and revokes", async ({ page, playwright, baseURL }) => {
  await page.goto("/signup");
  await signUp(page, uniqueEmail("api"));
  await page.goto("/app/settings");
  await page.getByRole("link", { name: "API keys and MCP" }).click();

  await page.getByLabel("Key name").fill("Read bot");
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(page.getByLabel("New API key", { exact: true })).toHaveText(/^tpk_/);
  const readKey = ((await page.getByLabel("New API key", { exact: true }).textContent()) ?? "").trim();
  expect(readKey).toMatch(/^tpk_/);
  await page.reload();
  await expect(page.getByText(readKey)).toHaveCount(0);
  await page.getByLabel("Key name").fill("Writer");
  await page.getByLabel("Access", { exact: true }).selectOption("write");
  await page.getByLabel("Monthly spending cap (USD)").fill("20");
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(page.getByLabel("New API key", { exact: true })).not.toHaveText(readKey);
  const writeKey = ((await page.getByLabel("New API key", { exact: true }).textContent()) ?? "").trim();
  expect(writeKey).toMatch(/^tpk_/);
  expect(writeKey).not.toBe(readKey);

  const api = await playwright.request.newContext({ baseURL });
  expect((await api.get("/api/v1/me")).status()).toBe(401);
  const me = await api.get("/api/v1/me", { headers: { "x-api-key": readKey } });
  expect(me.status()).toBe(200);
  expect((await me.json()).data.credential).toMatchObject({ scope: "read" });
  const denied = await api.post("/api/v1/videos", { headers: { "x-api-key": readKey }, data: { prompt: "30s video about cold brew" } });
  expect(denied.status()).toBe(403);
  const created = await api.post("/api/v1/videos", { headers: { "x-api-key": writeKey }, data: { prompt: "30s video about oat-milk cold brew" } });
  expect(created.status()).toBe(201);
  const video = (await created.json()).data as { id: string; costUsd: number };
  expect(video.costUsd).toBeGreaterThan(0);

  const rpc = (key: string, body: unknown) =>
    api.post("/api/mcp", { headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream" }, data: body });
  const init = await rpc(readKey, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  expect((await init.json()).result.serverInfo.name).toBe("torq-pamba");
  const call = await rpc(readKey, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_video", arguments: { id: video.id } } });
  expect((await call.json()).result.structuredContent.data).toMatchObject({ id: video.id, status: "ready" });
  const unauth = await api.post("/api/mcp", { data: { jsonrpc: "2.0", id: 3, method: "tools/list" } });
  expect(unauth.status()).toBe(401);
  expect(unauth.headers()["www-authenticate"]).toContain("resource_metadata=");

  await page.reload();
  const table = page.getByRole("table", { name: "API access" });
  await expect(table.getByRole("row").filter({ hasText: "Writer" })).toContainText(`$${video.costUsd.toFixed(2)} / $20.00`);
  await page.getByRole("button", { name: "Revoke Read bot" }).click();
  await expect(page.getByRole("status")).toContainText("Access revoked.");
  expect((await api.get("/api/v1/me", { headers: { "x-api-key": readKey } })).status()).toBe(401);
  await page.goto(`/app/videos/${video.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/not found/i)).toHaveCount(0);
  await api.dispose();
});

test("connects an MCP client with OAuth 2.1 (dynamic registration, consent, PKCE, spending cap)", async ({ page, playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const resource = await (await api.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(resource.resource).toBe(`${baseURL}/api/mcp`);
  const meta = await (await api.get("/.well-known/oauth-authorization-server")).json();
  expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  const registered = await api.post(meta.registration_endpoint, { data: { client_name: "E2E Agent", redirect_uris: ["http://127.0.0.1:7777/callback"] } });
  expect(registered.status()).toBe(201);
  const client = await registered.json();

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:7777/callback",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "read write",
    state: "e2e-state",
    resource: resource.resource,
  }))
    authorize.searchParams.set(k, v);

  let callback = "";
  await page.route("http://127.0.0.1:7777/**", async (route) => {
    callback = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Client received the code.</p>" });
  });

  await page.goto(authorize.toString());
  await expect(page).toHaveURL(/\/login\?next=%2Foauth%2Fconsent|\/login\?next=\/oauth\/consent/);
  await page.getByRole("main").getByRole("link", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("oauth"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("OAuth Studio");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Allow E2E Agent to use OAuth Studio?" })).toBeVisible();
  await page.getByLabel("Monthly spending cap for this app (USD)").fill("7.5");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("Client received the code.")).toBeVisible();
  const returned = new URL(callback);
  expect(returned.searchParams.get("state")).toBe("e2e-state");
  const code = returned.searchParams.get("code") ?? "";

  const token = await api.post(meta.token_endpoint, {
    form: { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "http://127.0.0.1:7777/callback", code_verifier: verifier },
  });
  expect(token.status()).toBe(200);
  const issued = await token.json();
  expect(issued).toMatchObject({ token_type: "Bearer", scope: "write" });
  const replay = await api.post(meta.token_endpoint, {
    form: { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "http://127.0.0.1:7777/callback", code_verifier: verifier },
  });
  expect(replay.status()).toBe(400);

  const tools = await api.post("/api/mcp", { headers: { authorization: `Bearer ${issued.access_token}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_workspace", arguments: {} } } });
  expect((await tools.json()).result.structuredContent.data).toMatchObject({ name: "OAuth Studio", credential: { kind: "oauth", scope: "write", spendCapUsd: 7.5 } });

  await page.goto("/app/settings/api");
  await expect(page.getByRole("table", { name: "API access" })).toContainText("OAuth: E2E Agent");
  await api.dispose();
});

test("free tools and the done-with-you page work without signing in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Free tools" }).click();
  await expect(page.getByText(/We do not offer a metadata scrubber/)).toBeVisible();

  await page.getByRole("link", { name: /Caption toolkit/ }).click();
  await page.getByLabel("Script", { exact: true }).fill("Grab one on the way. Open it, go, done.");
  await expect(page.getByLabel("SRT preview", { exact: true })).toContainText("1\n00:00:00,000 --> ");
  await expect(page.getByLabel("SRT preview", { exact: true })).toContainText("Open it, go, done.");
  await page.getByLabel("Post caption", { exact: true }).fill("Cold brew #coffee #oat @northwind");
  await expect(page.getByRole("status", { name: "Caption stats" })).toHaveText(/2 hashtags · 1 mentions/);

  await page.goto("/tools/de-slop");
  await page.getByLabel("Original text", { exact: true }).fill("In today's fast-paced world, we delve into cold brew.");
  await expect(page.getByLabel("Rewritten text", { exact: true })).toHaveValue("We dig into cold brew.");
  await expect(page.getByRole("status", { name: "Changes" })).toContainText("Throat-clearing opener");

  await page.goto("/tools/safe-zone");
  await expect(page.getByRole("status", { name: "Safe-zone check" })).toContainText("Text is clear of the app UI");
  await page.getByLabel("Text top (%)", { exact: true }).fill("85");
  await expect(page.getByRole("status", { name: "Safe-zone check" })).toContainText("caption and music bar cover the bottom");

  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Done with you" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ada");
  await page.getByLabel("Work email", { exact: true }).fill("ada@localhost");
  await page.getByRole("button", { name: "Request a call" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid email" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Ada");
  await page.getByLabel("Work email", { exact: true }).fill("ada@northwind.example");
  await page.getByRole("button", { name: "Request a call" }).click();
  await expect(page.getByRole("status")).toContainText("We'll reply by email");
});
