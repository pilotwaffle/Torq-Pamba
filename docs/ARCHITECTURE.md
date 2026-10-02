# Architecture

Torq-Pamba is a Next.js App Router app. Pages and server actions handle HTTP. Rules that must be tested without a browser live in `src/lib`. Drizzle talks to Postgres when `DATABASE_URL` is set, and to embedded PGlite otherwise.

## Modules

| Module | Responsibility |
|---|---|
| `src/app` | Routes. Public site (`/`, `/terms`, `/privacy`, `/login`, `/signup`, `/demo-site`), invite acceptance (`/invite/[token]`), studio (`/app` and children), and three route handlers |
| `src/components` | Forms and panels: onboarding, avatars, chat, preview player, approval, schedule, public chrome |
| `src/components/app-shell` | Sidebar nav entries (`nav.config.tsx`) and sidebar widgets (`sidebar.config.tsx`) as config arrays |
| `src/lib/auth` | Email and scrypt password, session cookie `tp_session` (httpOnly, SameSite=Lax), `requireUser` and `requireWorkspace` |
| `src/lib/onboarding` | Fetch a public page, extract a brand profile, save the brief, import assets, record rights |
| `src/lib/avatars` | Eight stock SVG avatars, niche shortlist, text-to-portrait generation, workspace exclusivity |
| `src/lib/agent` | A chat turn: `tools/` holds one file per chat tool (plan, schedule, list-schedule); `run.ts` matches the message to a tool and runs it |
| `src/lib/models` | Per-model catalog, one file per vendor: list price with its source, tier, fallback-chain position, avatar plan. Pure data, safe in client components |
| `src/lib/pricing` and `src/lib/router` | Cost estimates and fallback chains derived from the catalog, parallel scene generation, stitch, budget cap, charge on success |
| `src/lib/providers` | Vendor adapters (one file each, listed in `adapters.ts`), the registry, and the mock provider |
| `src/lib/approval.ts` | The gate. Privacy has no default. Consents start unchecked. The AI label starts on |
| `src/lib/schedule.ts` | Slots at 09:00, 12:00, and 18:00 in the workspace timezone. `processDueItems` sets `due_manual`. There is no publish function |
| `src/lib/billing.ts` | Free / Creator / Studio as placeholder test-mode plans. Refuses `sk_live_` |
| `src/db` | Schema (`src/db/schema/`, one file per domain) and `getDb()` |

`getDb()` stores its promise on `globalThis` so Next.js dev reload does not open PGlite twice, and it runs the SQL in `./drizzle` on first use. `PGLITE_DIR=memory` keeps the database in memory. `next.config.ts` lists `@electric-sql/pglite` in `serverExternalPackages`. Routes that use the database set `dynamic = "force-dynamic"` so `next build` does not connect.

Provider calls go through `isLive`. That is true only when `PROVIDER_MODE=live`, the adapter’s key is set, and `NODE_ENV` is not `test`. Otherwise `generateClip` returns deterministic SVG frames from `mock.ts`. A prompt containing `[refuse]` makes the mock video provider throw `ProviderRefusedError` on the first attempt for that scene and succeed on the next, so one step of the fallback chain can be exercised. `[refuse-all]` refuses every attempt.

Live chat, when enabled, tries Anthropic (Claude Sonnet 5), then xAI (Grok 4.7), then Google (Gemini 3.8 Flash). The mock agent does not need a model: each chat tool's `match` reads the utterance (lowest `priority` first), its zod `parameters` validate the arguments, and the plan tool fills a template from the brief.

## Data model

Defined in `src/db/schema/`, one file per domain, all re-exported from `src/db/schema/index.ts`. Enums live in `enums.ts`. Money columns are `numeric(12, 2)`. Every table with a `workspace_id` cascades on workspace delete (tested).

| Table | Holds |
|---|---|
| `users` | Email and scrypt password hash |
| `sessions` | Random session token and expiry |
| `workspaces` | Name, timezone (default UTC), onboarding step, brief JSON, `budget_cap_usd` (default 25), `ai_disclosure_default` (default true), plan, Stripe customer id |
| `members` | User, workspace, role `owner` \| `admin` \| `member` |
| `invites` | Token, role, 14-day expiry, acceptance |
| `assets` | URL, source snippet, `rights_confirmed` (default false) |
| `avatars` | Name, look, voice id, scenes, portrait, exclusive to `workspace_id` |
| `chat_messages` | User and assistant turns. A plan is stored on the assistant message |
| `videos` | Status `draft` \| `planned` \| `generating` \| `ready` \| `approved` \| `scheduled` \| `failed`. Tier, model, plan, cost estimate, `cost_actual_usd`, `ai_generated` (default true), stitched manifest, approval JSON |
| `generation_attempts` | Provider, status `ok` \| `refused` \| `error`, `cost_usd`. Failed attempts store 0 |
| `schedule_items` | `scheduled_at`, status `scheduled` \| `due_manual` \| `canceled` |
| `audit_log` | Workspace, actor, action, data JSON. Used for approval, disclosure changes, schedule changes, and plan changes |

Migration `0001_v2_foundation` adds the tables below for the v2 features (`docs/V2-PLAN.md`). The current code does not write to them yet, apart from the defaults on new columns.

| Table | Holds | File |
|---|---|---|
| `media_assets` | Stored file: storage driver (`inline` \| `local` \| `s3` \| `external`), key and URL, mime, size in bytes, duration, width and height, sha256, source (`upload` \| `generated` \| `render` \| `import`). Onboarding uploads keep rights on `assets`, which links here through `assets.media_asset_id` | `media.ts` |
| `generation_jobs` | One provider job: kind (clip, image, voice, voice_clone, lipsync, render), provider and provider job id, status, poll count, `next_poll_at`, deadline, output asset, cost | `media.ts` |
| `video_renders` | A stitched final MP4 per video, with status and the output asset. `videos.current_render_id` points at the live one | `media.ts` |
| `video_scenes`, `scene_takes` | Editor scenes in order, each with numbered takes and a `selected_take_id`. A take has its job, clip, poster, voice, and lip-sync assets | `editor.ts` |
| `video_captions`, `video_hooks` | Editable caption cues (`ai` or `user`) and hook options, at most one selected per video | `editor.ts` |
| `conversations`, `chat_tool_calls` | Chat threads (`chat_messages.conversation_id`) and each tool call: name, arguments, status (pending, awaiting_confirmation, running, succeeded, failed, rejected), result, cost | `chat.ts` |
| `voices`, `voice_clones`, `voice_clone_samples` | Catalog voices (`workspace_id` null) and workspace clones with consent fields. `avatars.tts_voice_id` and `avatars.lipsync_model` choose an avatar's voice | `voices.ts` |
| `inspiration_accounts`, `viral_posts`, `trends`, `ideas` | Tracked accounts, discovered posts with metrics, trends, and ideas linked to a source post or trend | `research.ts` |
| `plans` | Credit plans: Free, Hobby ($16/mo, 1,600 credits), Pro ($100/mo, 10,000). `workspaces.plan_id` references it; the legacy `plan` column maps creator to hobby and studio to pro | `credits.ts` |
| `credit_ledger`, `credit_top_ups`, `credit_charges` | Signed ledger entries with balance after and an idempotency key; Stripe top-ups; per-generation charges that go reserved → captured, or released on failure | `credits.ts` |
| `publishing_connections`, `publish_attempts`, `post_analytics_snapshots` | Wave 2 only. Official-API OAuth connections (token ciphertext only, never plaintext), attempts with `ai_disclosure` default true, metric snapshots | `publishing.ts` |
| `knowledge_items`, `api_keys` | Workspace memory items, and REST API keys stored as a hash plus a display prefix | `platform.ts` |

The status enum also includes `draft` and `planned`. The chat path inserts the row as `generating`, then sets `ready` or `failed`. Approval sets `approved`. Scheduling sets the video to `scheduled` and inserts a `schedule_items` row. The cron tick does not add another video status; it moves the schedule row to `due_manual`.

## Request flow

1. The browser loads a server component. `requireWorkspace` reads `tp_session` and the membership.
2. A form posts to a server action. The action checks the session, calls a `src/lib` function, and redirects or returns a small result.
3. Onboarding: `fetchSite` downloads HTML, `getBrandExtractor` pulls company, products, audience, tone, logo, and images, each with the snippet it came from. The user edits and saves the brief, confirms rights on each asset, and picks an avatar. Step 5 of onboarding links to `/app/accounts`, where official accounts are connected. The step number is stored on the workspace.
4. Chat: `handleUserMessage` parses the text. A video request stores a plan and an itemized `estimateClipCost` (script, frames, video, voice, total). Nothing is generated until `generateFromMessage` runs from the Generate button.
5. Generate: `generateVideo` compares the estimate with the remaining monthly budget, inserts a `generating` row, and runs the three scenes with `Promise.all` through `FALLBACK_CHAIN` for the chosen tier. Each attempt is inserted. On full success the router writes a stitched manifest (ordered scenes, duration, caption track, hook) and `cost_actual_usd`. On failure the video is `failed` and the cost stays 0.
6. Approval: `canApprove` requires a privacy value, music consent, and schedule consent. Commercial disclosure requires a type. Clearing the AI label requires `confirmAiOff`. `approveVideo` writes the approval JSON and the audit row.
7. Schedule: the user picks a datetime or the next 09:00 / 12:00 / 18:00. Only an approved video can be queued. `POST /api/cron/tick` requires Bearer `CRON_SECRET` (fail-closed rules below). It calls `processDueItems`: rows without targets become `due_manual`; rows with connected-account targets become `publishing` and enqueue `publish_jobs`, which `processPublishQueue` runs through `src/lib/publish/dispatch.ts` (mock publisher by default, official APIs under `src/lib/publish/live/` only with `PUBLISH_MODE=live`).

Stripe checkout is `POST /api/billing/checkout`. It creates a test-mode Checkout Session when `STRIPE_SECRET_KEY` is an `sk_test_` key and the price id is set. Otherwise it marks the workspace plan in the database and tells the UI the upgrade was simulated. `POST /api/billing/webhook` verifies the signature with `STRIPE_WEBHOOK_SECRET`.

Both machine endpoints fail closed. With `CRON_SECRET` or `STRIPE_WEBHOOK_SECRET` unset they return 401, unless `ALLOW_INSECURE_LOCAL_ENDPOINTS=1` and `NODE_ENV` is not `production` (`src/lib/local-mode.ts`).

## Phase 2 additions

- Live adapters (`src/lib/providers/*`) submit, then `pollUntil` the vendor job with backoff (`PROVIDER_POLL_TIMEOUT_MS`, default 10 minutes), then `downloadClip` (https, `video/*`, size-capped) into `src/lib/media/storage.ts` (`MEDIA_DIR`). When every scene has media, `stitchClips` (ffmpeg) concatenates them at 720x1280/30fps with burned SRT captions and stores `videos.media_key`. `/api/media/<key>` serves files by unguessable key so platforms can pull them (`PUBLIC_BASE_URL`).
- `social_accounts` (encrypted tokens), `publish_jobs`, `publish_events`, `post_metrics`, in `src/db/schema/publishing.ts` next to the wave-0 placeholder tables (`publishing_connections`, `publish_attempts`, `post_analytics_snapshots`), which phase 2 does not use yet. OAuth for TikTok, Instagram and Facebook uses signed state and PKCE (`src/lib/publish/oauth.ts`).
- `src/lib/analytics` stores metric snapshots per posted job.

The monthly budget sums `generation_attempts.cost_usd` for rows with status `ok` since the start of the month in the workspace timezone.

## How to add a feature

Each extension point is a list that a feature adds one entry to, so parallel branches touch different files or different lines. Every list has a test that fails on duplicates.

| To add | Do this | Tested by |
|---|---|---|
| A table or column | Edit or add a file in `src/db/schema/`, export it from `index.ts`, run `npm run db:generate`, commit `./drizzle`. Wave 1 should not need one: `0001` already holds the v2 tables | `src/db/migration.test.ts` (no drift between schema and migrations, workspace cascades) |
| A priced model | Append an entry to `src/lib/models/<vendor>.ts` with `source` citing the vendor page and date. To join a fallback chain, set `chains: { standard: 1.5 }`; a fractional position slots between neighbours. A new vendor file is one line in `models/vendors.ts` | `src/lib/models/catalog.test.ts` (`catalogProblems` must be empty) |
| A provider adapter | Add `src/lib/providers/<vendor>.ts` exporting `adapter = defineAdapter({ id, video: [...], image: [...], llm: [...] })`, then one line in `providers/adapters.ts`. For catalog-priced video use `catalogVideoProvider(id, { envKeys, live })`, which mocks when keys are missing. A new capability (voice, lipsync, render) is a `declare module "@/lib/providers/types" { interface ProviderKinds { voice: VoiceProvider } }` in the feature's own file, then `registry.get("voice", id)` | `src/lib/providers/registry.test.ts` |
| A chat tool | Add `src/lib/agent/tools/<name>.ts` with `defineTool({ name, description, parameters: z.object(...), priority, match, run })` and one line in `tools/all.ts`. `match` is the keyless parser; `run` gets zod-validated arguments and replies through `ctx.reply`. `chatTools.definitions()` gives JSON Schema for a tool-calling model | `src/lib/agent/tools/registry.test.ts`, `src/lib/agent/agent.test.ts` |
| A sidebar page | Add `src/app/app/<page>/page.tsx` and one `NAV_ITEMS` entry in `src/components/app-shell/nav.config.tsx` with an unused `order` (gaps of 100). A sidebar badge or meter is one `SIDEBAR_WIDGETS` entry in `sidebar.config.tsx` | `src/components/app-shell/shell.config.test.ts`, `e2e/core/shell.spec.ts` |
| An e2e spec | Add `e2e/<feature>/*.spec.ts`. Import `test` and `expect` from `e2e/support`; the `account` fixture signs up a fresh workspace, so specs never share data. Reuse steps from `e2e/support/steps.ts` (`completeOnboarding`, `planVideo`, `generateAndReview`, `approveAndSchedule`) instead of copying them. Change `e2e/core/` only when the core journey itself changes | `CI=1 npm run test:e2e` |

When two branches append to the same list, the merge conflict is two adjacent added lines; keep both. Keep mock mode working with no keys: anything that calls a vendor goes behind `isLive`, and anything that charges credits must record nothing on failure.

## Phase 3 additions (reach engine)

- `src/lib/reach/hooks.ts`: hook patterns (question, POV, number, contrarian, social proof, before/after, curiosity), a policy filter for claims platforms reject, and `generateHookVariants` (control A plus re-hooked variants, proven patterns first).
- Tables live in `src/db/schema/reach.ts` (migration `0003_phase3_reach`).
- `src/lib/reach/experiments.ts`: `hook_experiments` and `hook_variants`. A variant is a new `videos` row that reuses the base clips with a new hook (on screen for the first 2 s), costs $0, and needs approval (the user can apply the base approval to all variants explicitly). Launch enqueues one Instagram `trial_reel` publish job per variant; `pickWinner` ranks by views or engagement once every variant has `min_views`; the decision writes a `knowledge_tiles` row (source `experiment`).
- `src/lib/reach/knowledge.ts`: Knowledge tiles. `provenHooks` feeds `buildPlan` through the `plan` chat tool (`src/lib/agent/tools/plan.ts`; the plan leads with the best proven hook) and the next hook test.
- `src/lib/reach/handoff.ts`: `ad_handoffs` for TikTok Spark Ads (sealed authorization code) and Meta partnership ads. No marketing-API calls; a source scan test enforces that.
- `src/lib/reach/creators.ts`: `creator_briefs` with Markdown (TikTok One) and CSV (Billo / Collabstr) export at `GET /api/reach/briefs/<id>?format=md|csv` (session required).

## Phase 4 additions (platform)

- `src/lib/platform/credentials.ts`: `api_credentials` holds API keys (`tpk_`), OAuth access tokens (`tpa_`, 1 hour) and refresh tokens (`tpr_`, 30 days). Only a SHA-256 hash and a display prefix are stored. Every credential has a `grant_id`; an access/refresh pair shares one, and revoking or rotating acts on the whole grant. Each grant has a scope (`read` or `write`) and an optional monthly spending cap in USD (calendar month, UTC). `api_requests` logs every call with its cost and backs a 120-requests-per-minute limit per grant.
- `src/lib/platform/operations.ts`: the shared operations behind REST and MCP (workspace, list/get video, estimate, create video, schedule, analytics, Knowledge). `createVideoOp` refuses read-only credentials (403), checks the estimate against the grant's cap and the workspace budget before spending (402), and returns 422 when every provider fails. Failed generations cost $0, as in the app.
- `src/lib/platform/rest.ts` and `src/app/api/v1/[[...path]]`: `GET /api/v1/me`, `GET|POST /api/v1/videos`, `GET /api/v1/videos/<id>`, `POST /api/v1/estimate`, `GET /api/v1/schedule`, `GET /api/v1/analytics`, `GET /api/v1/knowledge`. Auth is `X-API-Key: <key>` or `Authorization: Bearer <token>`. Responses are `{ data }` or `{ error: { code, message } }`.
- `src/lib/platform/mcp.ts` and `src/app/api/mcp`: a stateless Streamable-HTTP MCP server (JSON responses, protocol `2025-06-18`): `initialize`, `ping`, `tools/list`, `tools/call` with 8 tools mapped to the operations above. A missing or bad token returns 401 with `WWW-Authenticate: Bearer resource_metadata=...` so MCP clients can discover the authorization server.
- `src/lib/platform/authserver.ts`: an OAuth 2.1 authorization server. Metadata at `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728); dynamic client registration at `/api/oauth2/register` (public clients, https or loopback redirect URIs only); `/oauth/authorize` (PKCE S256 required) stores the request in an httpOnly cookie and sends the user to `/oauth/consent` (through login when needed); consent picks read or write and a spending cap; `/api/oauth2/token` exchanges single-use codes (10 minutes) and rotates refresh tokens. Origins come from `PUBLIC_BASE_URL` when set.
- `/app/settings/api`: create keys (shown once), see spend against cap, revoke keys and connected apps (owner or admin).
- Free tools (`src/lib/tools/`, `src/components/tools/`, `/tools/*`): safe-zone previewer, caption toolkit (SRT and caption limits), de-slop rewriter. All run in the browser; nothing is uploaded. There is no metadata scrubber by design.
- Done-with-you (`src/lib/service.ts`, `/done-with-you`): a lead form stored in `service_requests` (honeypot, validation). No email is sent.
- Tables live in `src/db/schema/platform.ts` next to the wave-0 `api_keys` placeholder (unused by this code). Migration `drizzle/0004_phase4_platform.sql`.
