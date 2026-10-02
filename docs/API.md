# REST API and MCP server

Torq-Pamba exposes one set of operations two ways: a REST API at `/api/v1` and a remote MCP server at `/api/mcp`. Neither can approve, schedule, or publish a video; those stay human actions in the app.

## Credentials

- **API keys** (`tpk_…`). Create them in **Settings → API keys and MCP** (`/app/settings/api`, owner or admin). A key is shown once and stored only as a SHA-256 hash. Choose **Read only** or **Read and generate**, and optionally a monthly credit ceiling (`api_keys.max_credits`, $0.01 per credit until the credits ledger lands).
- **OAuth 2.1** for MCP clients. Clients discover the server from the 401 response, register dynamically, and send the user through consent, where the user picks read or write and a cap. Access tokens (`tpa_…`) last 1 hour; refresh tokens (`tpr_…`) last 30 days and rotate on use.

Send either as `X-API-Key: <key>` or `Authorization: Bearer <token>`. Revoking a key or connected app takes effect on the next request.

Limits: 120 requests per minute per key or grant (429). Credit ceilings reset at the start of each calendar month (UTC). Generation also stops at the workspace's monthly budget. Failed generations are never charged.

## REST

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | read | Workspace, budget, and this credential's scope, cap and spend |
| GET | `/api/v1/videos?limit=` | read | Newest first, `limit` 1–100 (default 20) |
| GET | `/api/v1/videos/<id>` | read | Scenes, cost, approval state |
| POST | `/api/v1/estimate` | read | `{ "durationS"?: 6–60, "tier"?: "budget" \| "standard" \| "premium" }`: price before generating |
| POST | `/api/v1/videos` | write | `{ "prompt": "...", "durationS"?: 30, "tier"?: "standard", "hookIndex"?: 0–2 }`. 201, or 402 `spend_cap_exceeded` / `budget_exceeded`, or 422 `generation_failed` |
| GET | `/api/v1/schedule` | read | Upcoming queue items |
| GET | `/api/v1/analytics` | read | Latest post metrics |
| GET | `/api/v1/knowledge` | read | Brand Knowledge tiles, including proven hooks |

Success: `{ "data": ... }`. Error: `{ "error": { "code": "...", "message": "..." } }` with 400, 401, 402, 403, 404, 405, 422 or 429.

```bash
curl -H "X-API-Key: $TORQ_KEY" https://<your-host>/api/v1/me
curl -X POST -H "X-API-Key: $TORQ_KEY" -H "content-type: application/json" \
  -d '{"prompt":"30s video about our oat-milk cold brew"}' https://<your-host>/api/v1/videos
```

## MCP

Endpoint: `POST https://<your-host>/api/mcp` (Streamable HTTP, JSON responses, no SSE stream, protocol `2025-06-18`). `GET` and `DELETE` return 405.

Tools: `get_workspace`, `list_videos`, `get_video`, `estimate_video_cost`, `create_video` (write), `list_schedule`, `get_analytics`, `list_knowledge`. Tool errors come back as `isError: true` results with the same codes as REST.

OAuth discovery:

- Protected resource metadata: `/.well-known/oauth-protected-resource/api/mcp`
- Authorization server metadata: `/.well-known/oauth-authorization-server`
- Registration: `POST /api/oauth2/register` (public clients; redirect URIs must be https or loopback)
- Authorize: `/oauth/authorize` (PKCE `S256` required; `scope` is `read` or `read write`)
- Token: `POST /api/oauth2/token` (`authorization_code`, `refresh_token`)

Set `PUBLIC_BASE_URL` to the https origin so the issuer and resource URLs are stable behind a proxy.
