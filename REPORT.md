# Torq-Pamba rebuild: phases 2–4, ported onto the v2 foundation

**Current branch:** `feat/phase2-plus-on-v2` in `/home/box/torq-pamba-rebuild`, built on Boris's `feat/v2-foundation` at `84b22bb28145f09f5316c03e36069dd3211ba55e` (fetched read-only from origin). Phases 2, 3 and 4 were cherry-picked one commit per phase, then a report commit, then `036ab55`, which consolidates them onto Boris's foundation tables (see "Consolidation onto the foundation tables").

**Fallback:** the original branch `feat/phase2-plus` (base `7f4cc80`, head `57a17eb`) is unchanged.

**Publishing criterion.** Reversing the V2 no-publish criterion (CONTRIBUTING.md criterion 1 and README rule 1, narrowed in `7d62583`) needs Barry's explicit, named yes before any push or merge of this branch.

Nothing was pushed (the push URL is `DISABLED`). No PR, merge, tag or deploy was made. Boris's branches, worktrees and bundles were not modified. Mock mode is the default. No secrets are in the tree.

| Commit | What | Unit (Vitest) | e2e (Playwright) |
| --- | --- | --- | --- |
| `84b22bb` | Boris's v2 foundation (base) | 89 passed (17 files) | 3 passed, 1 skipped |
| `7d62583` | Phase 2: publish and measure, real video pipeline | 129 passed (22 files) | 5 passed, 1 skipped |
| `0a539df` | Phase 3: reach engine | 157 passed (24 files) | 7 passed, 1 skipped |
| `fbd82e8` | Phase 4: platform | 180 passed (26 files) | 10 passed, 1 skipped |
| `b62818b` | REPORT.md | 180 passed (26 files) | 10 passed, 1 skipped |
| `036ab55` | Consolidate onto foundation tables (migrations 0005, 0006) | 182 passed (26 files) | 10 passed, 1 skipped |
| this commit | REPORT.md update | 182 passed (26 files) | 10 passed, 1 skipped |

**Unit count check.** The target was at least base plus ported tests. Base is 89. The ported tests are 91: 140 on the old branch minus 49 on the original main, made up of 40 in phase 2, 28 in phase 3 and 23 in phase 4. 89 + 91 = 180, and 180 pass. No ported test was dropped. The consolidation added 2 more (an `ai_disclosure` publish test and a 0005/0006 migration test), giving 182. The two fail-closed tests that overlap with Boris's coverage were kept and moved to his 401 semantics.

**Original branch, for reference** (`feat/phase2-plus` on `7f4cc80`, original main = 49 unit):

| Commit | Unit | e2e | Bundle |
| --- | --- | --- | --- |
| `f187591` | 89 | 4 + 1 skipped | `/home/box/backups/torq-pamba/torq-pamba-phase2-f187591.bundle` |
| `9d88ad6` | 117 | 6 + 1 skipped | `/home/box/backups/torq-pamba/torq-pamba-phase3-9d88ad6.bundle` |
| `4c04a12` | 140 | 9 + 1 skipped | `/home/box/backups/torq-pamba/torq-pamba-phase4-4c04a12.bundle` |

Gate commands, run before every commit:

```bash
npm run typecheck && npm run lint && npm test   # unit
CI=1 npm run test:e2e                            # production build on :3100, Chromium
```

**The skipped e2e test.** It is Boris's `e2e/core/capture.spec.ts`, which runs only with `CAPTURE=1` because it rewrites `docs/images` and `docs/media`. It is skipped on his base too. On this branch I ran `CAPTURE=1 CI=1 npx playwright test e2e/core/capture.spec.ts` (1 passed) and then reverted the regenerated media. No other test is skipped, `.only`, or weakened.

## Port onto feat/v2-foundation

### Migration renumbering

Boris's `0000_init` and `0001_v2_foundation` are byte-for-byte unchanged. My migrations were deleted and regenerated with `drizzle-kit generate --name …` against his snapshot chain, so the journal and snapshots come from drizzle-kit and were not hand-edited.

| Old (feat/phase2-plus) | New (feat/phase2-plus-on-v2) |
| --- | --- |
| `0001_phase2_publish` | `0002_phase2_publish` |
| `0002_phase3_reach` | `0003_phase3_reach` |
| `0003_phase4_platform` | `0004_phase4_platform` |

`src/db/migration.test.ts` checks two things: the schema matches the latest snapshot with no drift, and upgrading a database that holds main's data works. Both pass.

Its exact-list assertion (`["0000_init", "0001_v2_foundation"]`) was narrowed to three checks:
- those two come first
- every tag is numbered in order
- no later migration creates any v2 table

### How each collision was resolved

- **(a) Migrations.** Resolved as described above.
- **(b) Schema split.** Each phase's tables went into the foundation's per-feature files:
  - Phase 2 (`social_accounts`, `publish_jobs`, `publish_events`, `post_metrics`) is in `schema/publishing.ts`.
  - Phase 3 (`hook_experiments`, `hook_variants`, `knowledge_tiles`, `ad_handoffs`, `creator_briefs`) is in a new `schema/reach.ts`.
  - Phase 4 (`api_credentials`, `api_requests`, `oauth_clients`, `oauth_codes`, `service_requests`) is in `schema/platform.ts`.
  - All new enums are in `schema/enums.ts`. `videos.media_key`, `schedule_items.targets` and the `PublishTarget` type are in `schema/core.ts`.
  - Row types are exported from `schema/index.ts`, following his pattern.
  - Two enum clashes were handled without touching his enums:
    - Phase 2 uses his `social_platform` (which includes `youtube`), narrowed with `$type<"tiktok" | "instagram" | "facebook">()` on my tables.
    - My `knowledge_kind` became `knowledge_tile_kind`, because his `knowledge_kind` already exists with different values.
  - His `schedule_status` already included `publishing`, so no enum change was needed.
- **(c) e2e layout.** `e2e/journey.ts` changes landed in `e2e/support/steps.ts`: the banner regex and `makeApprovedVideo`. `PASSWORD` was already exported from `e2e/support/auth.ts`.
  - Specs moved to `e2e/publish/`, `e2e/reach/` and `e2e/platform/` and import from `e2e/support` (`signUpFresh`).
  - In the OAuth spec I added a wait for `/signup` before filling, because `/login` and `/signup` share the Email label and the fill could land mid-navigation.
- **(d) No-publish guard.** Boris's scan in `src/lib/schedule.test.ts` was narrowed only to allow the three endpoints under `src/lib/publish/live/`. It still scans all of `src/`, still checks the banner, and also searches for `/post/publish/`. It also asserts the allowlist isn't vacuous. A second test pins the only importers of `live/` to `lib/publish/dispatch.ts`, `lib/publish/accounts.ts` and `lib/analytics/index.ts`. `CONTRIBUTING.md` criterion 1 and README rule 1 were updated to match, as `docs/V2-PLAN.md` requires. Both are in the same commit as the narrowed guard (`7d62583`, together with the `schedule.test.ts` change), and the consolidation did not touch them. Reversing that criterion needs Barry's explicit, named yes before any push or merge.
- **(e) Media.** His base (`84b22bb`) has no `src/lib/media/`, so my `stitch.ts` and `storage.ts` were kept as they are. His wave-1 branch `a-video-pipeline` (`51f643e`, not in the base) has a different media API (`MediaStorage`, `video_renders`, `media_assets`). Merging that branch later will be an add/add conflict on both files plus `router.ts`.
- **(f) Fail-closed.** His cron and webhook code (`src/lib/local-mode.ts`: 401, with `ALLOW_INSECURE_LOCAL_ENDPOINTS=1` honoured outside production only) was kept. My 503 duplicate in `billing.ts`, `schedule.ts` and the webhook route was dropped, and his "opens only in explicit local mode" test was kept.
  - My `src/lib/security/fail-closed.test.ts` and the e2e fail-closed test now expect 401, so the coverage stays.
  - The tick still runs the publish queue after `processDueItems`.
- **Registries.**
  - Adapters stay on his `catalogVideoProvider`/`defineAdapter`; polling, download and `mediaKey` are layered into each `live` function.
  - Nano Banana 2 and Pro register as `image` providers of the `google` adapter, priced from his catalog entries, which existed with no adapter.
  - Proven hooks reach plans through his `plan` chat tool, not the removed `run.ts` if-chain.
  - Accounts, Analytics, Reach, Knowledge and Creators are `NAV_ITEMS` entries (orders 750–860).
  - The REST/MCP operations were not re-routed through `chatTools`, because his tools take free text and reply through a chat callback. That would have been a redesign.

## Consolidation onto the foundation tables (036ab55)

Boris's foundation tables are now canonical. My five duplicate tables are gone, and every phase 2–4 code path reads and writes his tables. Boris confirmed the mappings against `docs/V2-PLAN.md`.

| Phase table (dropped) | Foundation table (canonical) | Status |
| --- | --- | --- |
| `social_accounts` | `publishing_connections` | Done. Tokens are sealed into his encrypted token columns with `token_key_version` (currently 1). A token sealed under a different key version is refused, not decrypted. `scopes` is a text array. Disconnecting sets `status = revoked`. |
| `publish_jobs` | `publish_attempts` | Done. `ai_disclosure` (default true) is set from `videos.ai_generated` at enqueue and sent as the platform's AI label (TikTok `is_aigc`, Instagram `is_ai_generated`). Dispatch refuses to post an AI-generated video whose attempt has `ai_disclosure = false`. Statuses map as queued → `pending`, processing → `submitted`, succeeded → `published`, failed → `failed`, canceled → `canceled`. The TikTok 24 h creator cap counts by `submitted_at`. |
| `post_metrics` | `post_analytics_snapshots` | Done. These are official-API metrics only; null counters read as 0. |
| `knowledge_tiles` | `knowledge_items` | Done. Hooks, formats, brand facts and preferences feed the plan and the agent context. Kind `hook` → `hook_result`. Origin, evidence and the experiment id go into `source_ref`, with `source` = `user` (manual or brief) or `analytics` (experiment). Brief seeding writes audience → `brand_fact`, what-they-do → `angle` and tone → `preference`. |
| `api_credentials` | `api_keys` | Done. It stores the hash and display prefix, `scopes` plus `read_only` (scope fails closed to read), and `max_credits` as the monthly spend cap. The cap check returns 402 `spend_cap_exceeded` before any spend. |

**New columns (migration 0005).**
- `knowledge_kind` enum: added `angle` and `format`.
- `publishing_connections.mode` (text, default `'mock'`)
- `publish_attempts.mode` and `publish_attempts.privacy` (text, default `''`)
- `post_analytics_snapshots.reach` (bigint, nullable)
- `knowledge_items.score` (integer, default 0)
- `api_keys.kind` (`api_credential_kind`, default `'key'`), `api_keys.grant_id` (uuid, nullable, indexed by `api_keys_grant_idx`) and `api_keys.client_id` (text, nullable). These carry OAuth access and refresh tokens and their grant.
- `api_requests.credits` (integer, default 0)
- `oauth_codes.max_credits` (integer, nullable), replacing `oauth_codes.spend_cap_usd`
- Foreign keys re-pointed: `publish_events.job_id`, `ad_handoffs.job_id` and `hook_variants.publish_job_id` → `publish_attempts`; `hook_experiments.account_id` → `publishing_connections`.

**Why two migrations, not one 0005.** In a single generated migration, drizzle-kit emits the old foreign-key drops after `DROP TABLE … CASCADE`, so it fails on apply. I generated `0005_consolidate_foundation` (enum values, columns, FK re-points) and then `0006_drop_phase_duplicates` (drops `api_credentials`, `knowledge_tiles`, `post_metrics`, `publish_jobs`, `social_accounts` and the `knowledge_tile_kind` and `publish_job_status` enums). I did it from a temporary intermediate schema, so both files, the journal and the snapshots come from drizzle-kit and were not hand-edited. At each rename prompt I chose "create column". 0000–0004 are unchanged. All of 0000–0006 apply cleanly on PGlite, and `migration.test.ts` checks both.

**No data copy.** 0005 and 0006 copy no rows from the dropped tables, because this branch was never deployed and those tables never held production data. If any environment ever ran 0002–0004 with real data, it needs a hand-written copy before 0006.

**Credits vs USD.** `api_keys.max_credits` is an integer ceiling (0–10,000,000), so the old USD caps convert at $0.01 per credit (`USD_PER_CREDIT`), the same rate as Boris's f-credits branch. The base has no credit ledger. Spend under a ceiling is the sum of `api_requests.credits` for the grant in the calendar month (UTC). Switch to the ledger when f-credits lands. Settings shows "credits used / ceiling ($ spent)". The consent page and the key form ask for a "monthly credit ceiling" (OAuth default 1,000).

**Tables that stay.** `publish_events` (the audit trail for an attempt), `api_requests`, `oauth_clients`, `oauth_codes`, `service_requests` and the reach tables (`hook_experiments`, `hook_variants`, `ad_handoffs`, `creator_briefs`) have no foundation equivalent. They are kept, with their FKs re-pointed.

**Left as-is: `videos.media_key`.** Per Boris, `media_key` is not mapped onto `videos.current_render_id`, and my `src/lib/media/stitch.ts` and `storage.ts` stay as they are. At integration, `media_key` moves to branch a's render API. For the record, the `video_renders` table is already in the 84b22bb schema (`schema/media.ts`); what the base lacks is a render API to write it.

**Rebase pending.** Boris will send a wave1-integration SHA. This branch will be rebased onto it then. Nothing here waits on it.

## Why the work is split this way

The phases follow the README roadmap (research report section 4E), and each one depends on the one before:

- **Phase 2** turns mock clips into real files and posts them through official APIs.
- **Phase 3** needs published posts and metrics to run hook tests and write the winners back.
- **Phase 4** puts a REST, MCP and OAuth surface over the operations that now exist.

Each phase was committed and bundled only after both suites passed. That way a later failure can't take down earlier work.

## Phase 2: publish and measure (f187591, ported as 7d62583)

**Fail-closed endpoints.** On the old branch, `/api/cron/tick` and `/api/billing/webhook` returned 503 when their secret was unset. On the v2 base that is Boris's implementation (401, local-mode exception outside production); see collision (f).

**Real video pipeline.**
- Live adapters submit a job, then `pollUntil` with backoff (`PROVIDER_POLL_TIMEOUT_MS`, default 600 s).
- Output is downloaded (https only, `video/*`, size-capped) into `MEDIA_DIR`.
- ffmpeg stitches scenes to 720x1280 at 30 fps with burned captions and stores `videos.media_key`.
- `/api/media/<key>` serves files by an unguessable key so platforms can pull them.
- Nano Banana 2 and Pro image adapters were added. Their model ids are env-overridable.

**Publishing on official APIs only.**
- New tables: `social_accounts` (tokens sealed with AES-256-GCM), `publish_jobs`, `publish_events` and `post_metrics`. Since `036ab55`, all but `publish_events` are replaced by `publishing_connections`, `publish_attempts` and `post_analytics_snapshots`.
- OAuth uses HMAC state and PKCE for TikTok Login Kit, Instagram Business Login and Facebook Login for Business.
- TikTok uses Direct Post and falls back to upload-to-drafts. Until `TIKTOK_AUDITED=1`, posts are forced to `SELF_ONLY` and limited to 5 creators per 24 h.
- Instagram supports Reels and Trial Reels. Facebook supports Page Reels.
- Metrics come from TikTok `video.list` and Instagram insights.
- All live endpoint code is in `src/lib/publish/live/`, and a source-scan test controls which modules may import it.

**UI.** Accounts and Analytics pages, schedule targets, Post now, and a publish status and audit table.

**Docs.** STANDARDS.md was added. README, ARCHITECTURE, CONTRIBUTING, terms, privacy and `.env.example` were updated. CI installs ffmpeg; that change was made locally and never pushed.

**Tests.** Old branch: 89 unit, 4 e2e. On v2: 129 unit, 5 e2e. Added +40 unit tests and 2 e2e tests in `e2e/publish/publish.spec.ts`.

## Phase 3: reach engine (9d88ad6, ported as 0a539df)

All of it lives in `src/lib/reach/`:

- **Hook tests.** There are 7 hook patterns plus a policy filter for claims platforms reject. A variant is a re-cut of the base video with a new hook, costs $0, and needs approval. Each variant runs as an Instagram Trial Reel job. `pickWinner` ranks by views or engagement once every variant reaches the minimum views. A lift under 10% is saved as low confidence.
- **Knowledge write-back.** A winning hook becomes a Knowledge tile. The chat `buildPlan` leads with the proven hook, and the next test prefers proven patterns.
- **Ad hand-off.** TikTok Spark Ads (the authorization code is stored sealed) and Meta partnership ads are handed off for the customer to run in their own Ads Manager. There are no marketing-API calls, and a scan test enforces that.
- **Creator briefs.** Briefs export as Markdown (TikTok One) and CSV (Billo or Collabstr) at `/api/reach/briefs/<id>`. A session is required, and the CSV export guards against formula injection.
- **Pages.** `/app/reach`, `/app/reach/<id>`, `/app/knowledge` and `/app/creators`.
- **Migration.** `0003_phase3_reach` (was `0002`).

`playwright.config.ts` now sets a random `TOKEN_ENCRYPTION_KEY` for each run, because production mode refuses to seal tokens without one.

**Tests.** Old branch: 117 unit, 6 e2e. On v2: 157 unit, 7 e2e. Added +28 unit tests and 2 e2e tests in `e2e/reach/reach.spec.ts`.

## Phase 4: platform (4c04a12, ported as fbd82e8)

**Credentials** (`src/lib/platform/credentials.ts`). There are three kinds of secret: API keys (`tpk_`), OAuth access tokens (`tpa_`, valid 1 h) and refresh tokens (`tpr_`, valid 30 d). Only SHA-256 hashes are stored. Credentials are grouped into grants, and each grant has:
- a scope, read or write
- an optional monthly spending cap in USD (calendar month, UTC); since `036ab55` this is `api_keys.max_credits`, in credits at $0.01 each
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

**Free tools.** `/tools`, `/tools/safe-zone`, `/tools/captions` and `/tools/de-slop` all run client-side. On purpose, there is no metadata scrubber. **Done-with-you.** `/done-with-you` has a lead form with a honeypot field; submissions are stored in `service_requests`. **API docs.** `/docs/api` and `docs/API.md`. **Migration.** `0004_phase4_platform` (was `0003`).

**Copy fixes.** Several lines still described publishing as a future phase: the terms page, the landing page, the chat description and the README's "Live mode still does not publish". They now match the current behaviour.

**Tests.** Old branch: 140 unit, 9 e2e. On v2: 180 unit, 10 e2e (+23 unit, +3 e2e):
- `platform.test.ts` (14) covers keys, scopes, caps, 402/403/422, rate limits, REST routing, MCP JSON-RPC errors, OAuth registration and authorize validation, PKCE, code replay and refresh rotation.
- `tools.test.ts` (9).
- `e2e/platform/platform.spec.ts` (3):
  1. Keys are created in the UI, then exercised over REST and MCP, then revoked.
  2. The full OAuth browser flow runs end to end: discovery, registration, login, signup, consent with a cap, code, token, replay refused, then an MCP call.
  3. The public tools and the done-with-you form work.

## Existing tests I changed, and why (on the v2 branch, all are Boris's files unless noted)

1. **`src/lib/schedule.test.ts`, publish scan.** His blanket "no publish endpoints under src/" now allows them only under `src/lib/publish/live/`, plus a new importer-pin test (collision d). His cron tests are unchanged, including "opens the tick without CRON_SECRET only in explicit local mode". My old change to that cron test was dropped in favour of his.
2. **`src/db/migration.test.ts`.** The exact two-migration list became "foundation first, then numbered migrations that create no v2 table" (collision a).
3. **`src/components/app-shell/shell.config.test.ts`.** "keeps the shipped order" gains Accounts, Analytics, Reach, Knowledge and Creators. That is one entry per page, the way his nav registry is designed to grow.
4. **`src/lib/providers/registry.test.ts`.** "keeps the image and chat providers" now expects `nano-banana-2` and `nano-banana-pro` as well as `grok-imagine-image`, and checks that every image provider's price equals its catalog entry. Before, it checked only the first one.
5. **`e2e/support/steps.ts`.** The schedule banner regex changed to "official TikTok, Instagram and Facebook APIs only", because the banner text changed. `makeApprovedVideo` was added. No journey assertion was removed.
6. **Mine: `src/lib/security/fail-closed.test.ts` and `e2e/publish/publish.spec.ts`.** Unset-secret responses are expected as 401 (his semantics), not 503. The first also clears `ALLOW_INSECURE_LOCAL_ENDPOINTS` during the test.
7. **Mine: `e2e/platform/platform.spec.ts`.** It waits for `/signup` before filling the form (navigation race). In the port commit, the assertions were unchanged.
8. **Consolidation (`036ab55`), all mine except item 8e.**
   - a. `publish-flow.test.ts`: fields moved to the foundation tables and statuses. New test: "sets ai_disclosure from the video, sends it as the AI label, and never posts an AI-generated video without it".
   - b. `reach-flow.test.ts` and `reach-pure.test.ts`: the new knowledge kinds, `source_ref` origin, and `published` status. The validate test also accepts `format`.
   - c. `platform.test.ts`: `api_keys` and `max_credits`, credit assertions, and a fail-closed scope check.
   - d. `e2e/platform/platform.spec.ts`: "spending cap" labels became "credit ceiling" (2,000 and 750 credits). The Settings row is now expected to read `<credits> / 2,000 ($<usd>)`, and the OAuth test expects `maxCredits: 750`. It was renamed "…credit ceiling". Nothing was removed.
   - e. Boris's `src/db/migration.test.ts`: one new test, "consolidates the phase 2-4 tables onto the foundation tables (0005 adds columns, 0006 drops the duplicates)". His existing assertions are unchanged.

## Go-live checklist (none of this has been done)

- [ ] **Database.** Point `DATABASE_URL` at managed Postgres and run `npm run db:migrate` for migrations 0000–0006. 0006 drops the phase 2–4 duplicate tables without copying rows (they were never deployed); if any database holds data in them, copy it first.
- [ ] **Secrets.** Never set `ALLOW_INSECURE_LOCAL_ENDPOINTS` in a deployed environment (it is ignored when `NODE_ENV=production`, but keep it unset). Set `CRON_SECRET` and call `POST /api/cron/tick` with Bearer on a schedule. Set `STRIPE_WEBHOOK_SECRET`. Keep Stripe in test mode; the code refuses `sk_live_`.
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
- **Render model.** `videos.media_key` and my stitch and storage modules are still used, instead of `video_renders` and `current_render_id`. They move to branch a's render API at integration (see "Consolidation").
- **Credits.** The spend ceiling counts credits from `api_requests`. There is no shared credit ledger until f-credits lands.
- **Wave-1 merge.** This branch will be rebased onto Boris's wave1-integration SHA when he sends it. None of Boris's wave-1 feature branches (video pipeline, chat agent, voices, editor, research, credits) are on this base. Merging them will conflict at least on `src/lib/media/*` and `src/lib/router.ts` (video pipeline), the `plan` tool (chat agent), and the nav list and shell test (every feature that adds a page).
- **Won't build** (compliance): device or real-iPhone posting, managed accounts and warming, and a metadata scrubber.

## Blockers during the run

- **Stan milestone pings were not sent.** No agent-messaging tool was available, and using email, X or Notion instead would have been an unapproved external message. The drafts for all three are in the run's final report.
- **Claude Code's OAuth session expired**, so all the work was done directly, without delegating to it.
- **Consolidation run (2026-10-02).** drizzle-kit's drop ordering forced the 0005 and 0006 split (see "Consolidation"). Nothing else blocked.
- **Port run (2026-10-02).** No blockers. `feat/v2-foundation` was fetched read-only from origin, so the bundle and worktree fallbacks weren't needed.
