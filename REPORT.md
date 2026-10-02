# Torq-Pamba rebuild: phases 2–4 (overnight run, 2026-10-01)

Branch `feat/phase2-plus` in `/home/box/torq-pamba-rebuild`, based on `7f4cc80` (main at the time). This was never pushed: the push URL is set to `DISABLED`. No PR, merge, tag or deploy was made. Boris's `feat/v2-foundation` and his clone were not touched. Everything runs in mock mode by default. No secrets are in the tree.

| Phase | Commit | Unit (Vitest) | e2e (Playwright) | Bundle (`git bundle verify`) |
| --- | --- | --- | --- | --- |
| 2: publish and measure, real video pipeline | `f187591` | 89 passed (16 files) | 4 passed, 1 skipped | `/home/box/backups/torq-pamba/torq-pamba-phase2-f187591.bundle`: okay |
| 3: reach engine | `9d88ad6` | 117 passed (18 files) | 6 passed, 1 skipped | `/home/box/backups/torq-pamba/torq-pamba-phase3-9d88ad6.bundle`: okay |
| 4: platform | `4c04a12` | 140 passed (20 files) | 9 passed, 1 skipped | `/home/box/backups/torq-pamba/torq-pamba-phase4-4c04a12.bundle`: okay |

Gate commands, run before every commit:

```bash
npm run typecheck && npm run lint && npm test   # unit
CI=1 npm run test:e2e                            # production build on :3100, Chromium
```

**The skipped e2e test.** It is the pre-existing `e2e/capture.spec.ts`, which only runs with `CAPTURE=1` because it rewrites `docs/images` and `docs/media`. It was already skipped on main and was not changed. To show it still works, I ran `CAPTURE=1 CI=1 npx playwright test e2e/capture.spec.ts` (1 passed) and then reverted the regenerated media. No other test is skipped, `.only`, or weakened.

## Why the work is split this way

The phases follow the README roadmap (research report section 4E), and each one depends on the one before:

- **Phase 2** turns mock clips into real files and posts them through official APIs.
- **Phase 3** needs published posts and metrics to run hook tests and write the winners back.
- **Phase 4** puts a REST, MCP and OAuth surface over the operations that now exist.

Each phase was committed and bundled only after both suites passed. That way a later failure can't take down earlier work.

## Phase 2: publish and measure (f187591)

**Fail-closed endpoints.** `/api/cron/tick` and `/api/billing/webhook` now return 503 when `CRON_SECRET` or `STRIPE_WEBHOOK_SECRET` is unset, and the cron tick returns 401 on a wrong secret. This was a minor note in REVIEW.md.

**Real video pipeline.**
- Live adapters submit a job, then `pollUntil` with backoff (`PROVIDER_POLL_TIMEOUT_MS`, default 600 s).
- Output is downloaded (https only, `video/*`, size-capped) into `MEDIA_DIR`.
- ffmpeg stitches scenes to 720x1280 at 30 fps with burned captions and stores `videos.media_key`.
- `/api/media/<key>` serves files by an unguessable key so platforms can pull them.
- Nano Banana 2 and Pro image adapters were added. Their model ids are env-overridable.

**Publishing on official APIs only.**
- New tables: `social_accounts` (tokens sealed with AES-256-GCM), `publish_jobs`, `publish_events` and `post_metrics`.
- OAuth uses HMAC state and PKCE for TikTok Login Kit, Instagram Business Login and Facebook Login for Business.
- TikTok uses Direct Post and falls back to upload-to-drafts. Until `TIKTOK_AUDITED=1`, posts are forced to `SELF_ONLY` and limited to 5 creators per 24 h.
- Instagram supports Reels and Trial Reels. Facebook supports Page Reels.
- Metrics come from TikTok `video.list` and Instagram insights.
- All live endpoint code is in `src/lib/publish/live/`, and a source-scan test controls which modules may import it.

**UI.** Accounts and Analytics pages, schedule targets, Post now, and a publish status and audit table.

**Docs.** STANDARDS.md was added. README, ARCHITECTURE, CONTRIBUTING, terms, privacy and `.env.example` were updated. CI installs ffmpeg; that change was made locally and never pushed.

**Tests.** 89 unit tests, 4 e2e tests. The e2e tests added were `e2e/publish.spec.ts` (2).

## Phase 3: reach engine (9d88ad6)

All of it lives in `src/lib/reach/`:

- **Hook tests.** There are 7 hook patterns plus a policy filter for claims platforms reject. A variant is a re-cut of the base video with a new hook, costs $0, and needs approval. Each variant runs as an Instagram Trial Reel job. `pickWinner` ranks by views or engagement once every variant reaches the minimum views. A lift under 10% is saved as low confidence.
- **Knowledge write-back.** A winning hook becomes a Knowledge tile. The chat `buildPlan` leads with the proven hook, and the next test prefers proven patterns.
- **Ad hand-off.** TikTok Spark Ads (the authorization code is stored sealed) and Meta partnership ads are handed off for the customer to run in their own Ads Manager. There are no marketing-API calls, and a scan test enforces that.
- **Creator briefs.** Briefs export as Markdown (TikTok One) and CSV (Billo or Collabstr) at `/api/reach/briefs/<id>`. A session is required, and the CSV export guards against formula injection.
- **Pages.** `/app/reach`, `/app/reach/<id>`, `/app/knowledge` and `/app/creators`.
- **Migration.** `0002_phase3_reach`.

`playwright.config.ts` now sets a random `TOKEN_ENCRYPTION_KEY` for each run, because production mode refuses to seal tokens without one.

**Tests.** 117 unit tests, 6 e2e tests. The e2e tests added were `e2e/reach.spec.ts` (2).

## Phase 4: platform (4c04a12)

**Credentials** (`src/lib/platform/credentials.ts`). There are three kinds of secret: API keys (`tpk_`), OAuth access tokens (`tpa_`, valid 1 h) and refresh tokens (`tpr_`, valid 30 d). Only SHA-256 hashes are stored. Credentials are grouped into grants, and each grant has:
- a scope, read or write
- an optional monthly spending cap in USD (calendar month, UTC)
- a request log, which backs a limit of 120 requests per minute

Refresh rotation revokes the old pair and re-issues new tokens on the same grant.

**Shared operations** (`operations.ts`). REST and MCP both call the same functions: workspace, list and get video, estimate, create video, schedule, analytics and Knowledge.
- A read-only credential gets 403 when it tries to generate.
- The spending cap and the workspace budget are checked before any spend, and going over returns 402.
- If every model fails, the call returns 422 and costs $0.
- Nothing in the API can approve, schedule or publish.

**REST** at `/api/v1`. Auth is `X-API-Key` or Bearer.

**MCP server** at `/api/mcp`. It is stateless Streamable HTTP with JSON responses and protocol 2025-06-18, and it exposes 8 tools. A 401 response includes a `WWW-Authenticate` header pointing at the resource metadata.

**OAuth 2.1 authorization server.** It provides:
- metadata under RFC 8414 and RFC 9728
- dynamic client registration (https or loopback redirect URIs only)
- a mandatory PKCE S256 check
- a consent page where the user chooses read or write and sets a cap
- single-use authorization codes and a token endpoint

**Settings.** `/app/settings/api` creates keys (each is shown once), shows spend against each cap, and revokes keys and connected apps.

**Free tools.** `/tools`, `/tools/safe-zone`, `/tools/captions` and `/tools/de-slop` all run client-side. On purpose, there is no metadata scrubber. **Done-with-you.** `/done-with-you` has a lead form with a honeypot field; submissions are stored in `service_requests`. **API docs.** `/docs/api` and `docs/API.md`. **Migration.** `0003_phase4_platform`.

**Copy fixes.** Several lines still described publishing as a future phase: the terms page, the landing page, the chat description and the README's "Live mode still does not publish". They now match the current behaviour.

**Tests.** 140 unit tests, 9 e2e tests:
- `platform.test.ts` (14) covers keys, scopes, caps, 402/403/422, rate limits, REST routing, MCP JSON-RPC errors, OAuth registration and authorize validation, PKCE, code replay and refresh rotation.
- `tools.test.ts` (9).
- `e2e/platform.spec.ts` (3):
  1. Keys are created in the UI, then exercised over REST and MCP, then revoked.
  2. The full OAuth browser flow runs end to end: discovery, registration, login, signup, consent with a cap, code, token, replay refused, then an MCP call.
  3. The public tools and the done-with-you form work.

## Existing tests I changed, and why

1. **`src/lib/schedule.test.ts`.** "allows the tick when CRON_SECRET is unset" is now "refuses the tick when CRON_SECRET is unset" and expects 503. Fail-closed was a required security change, and the old test asserted the insecure behaviour.
2. **`src/lib/schedule.test.ts`, forbidden-endpoint scan.** The scan now allows official publish endpoints only under `src/lib/publish/live/`. A new test pins which modules may import `live/`: the dispatcher, account linking and analytics. Phase 2 has to call those endpoints, and this replaces a blanket ban with a tighter rule.
3. **`e2e/journey.ts`.** The schedule-page banner regex changed from "Publishing arrives in Phase 2" to "official TikTok, Instagram and Facebook APIs only", because the banner text changed. I also added the `makeApprovedVideo` helper and exported `PASSWORD` for the new specs. No journey assertion was removed.

## Go-live checklist (none of this has been done)

- [ ] **Database.** Point `DATABASE_URL` at managed Postgres and run `npm run db:migrate` for migrations 0001–0003.
- [ ] **Secrets.** Set `CRON_SECRET` and call `POST /api/cron/tick` with Bearer on a schedule. Set `STRIPE_WEBHOOK_SECRET`. Keep Stripe in test mode; the code refuses `sk_live_`.
- [ ] **Encryption and OAuth state.** `TOKEN_ENCRYPTION_KEY` (32 bytes) is required to seal social tokens and Spark codes. Losing it means reconnecting every account. Also set `OAUTH_STATE_SECRET`.
- [ ] **`PUBLIC_BASE_URL`.** Set it to the https origin. It is used for social redirect URIs, `/api/media` pulls, and the OAuth and MCP issuer and resource.
- [ ] **Platform apps.** Create the TikTok, Instagram and Meta apps, set their credentials, and register redirect URIs `<base>/api/oauth/<tiktok|instagram|facebook>/callback`. Pass app review for the needed scopes (lead times are in `docs/PHASE0-CHECKLIST.md`).
- [ ] **Publishing switches.** Set `PUBLISH_MODE=live`. Set `TIKTOK_AUDITED=1` only after TikTok's audit passes.
- [ ] **Generation.** Set `PROVIDER_MODE=live` and add vendor API keys. Install ffmpeg and ffprobe (or set `FFMPEG_PATH` and `FFPROBE_PATH`). Put `MEDIA_DIR` on persistent storage.
- [ ] **Verify ids and versions.** Check the Nano Banana model ids (`NANO_BANANA_2_MODEL` and `NANO_BANANA_PRO_MODEL`) and `META_GRAPH_VERSION` (default v24.0) against current vendor docs.

## Unverified against live APIs

Nothing was called live. These were written from public docs and may be wrong:
- TikTok Content Posting request and response shapes, including `creator_info` and status polling
- Instagram and Facebook Graph Reels publishing, including `trial_params` for Trial Reels
- the Graph API version
- the TikTok `video.list` and Instagram insights metric names
- the vendor video APIs (xAI, Google, Runway) and the Nano Banana model ids
- the Spark Ads authorization-code format and the in-app hand-off steps
- the safe-zone margins and caption length limits in the free tools, which are approximations

## Known gaps vs the Pamba parity MVP and REVIEW.md

- **Chat is still regex intents.** There is no LLM agent with tool calling.
- **Avatars and voices.** No TTS, voice clones or lip-sync; avatars are still SVG.
- **Editor.** No editor with takes. Captions and hooks are burned at stitch time but can't be edited in a UI.
- **Research.** Nothing for Discover, inspiration accounts, trends or ideas.
- **Billing.** No credit billing (Hobby or Pro plans, top-ups). Stripe stays test-only with USD budget caps.
- **Onboarding and batches.** No content-batch UI. No first-video concepts or plan step in onboarding. Media upload is still URL-only.
- **Analytics.** Views, likes, comments and shares only; no watch-time or retention analytics.
- **Social tokens.** Refresh tokens are stored sealed, but expired access tokens are never refreshed, so reconnecting is the only path.
- **MCP.** 8 tools versus Pamba's roughly 300. It is stateless JSON only, with no SSE stream or sessions, and it has no tools to approve, schedule or publish (by design).
- **Rate limiting** is counted in the database, which is fine for one region but is not a distributed limiter.
- **Done-with-you** leads are stored, but nobody is notified by email.
- **Ads.** No programmatic TikTok or Meta marketing-API use (hand-off only, by design).
- **Won't build** (compliance): device or real-iPhone posting, managed accounts and warming, and a metadata scrubber.

## Blockers during the run

- **Stan milestone pings were not sent.** No agent-messaging tool was available, and using email, X or Notion instead would have been an unapproved external message. The drafts for all three are in the run's final report.
- **Claude Code's OAuth session expired**, so all the work was done directly, without delegating to it.
