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
3. Onboarding: `fetchSite` downloads HTML, `getBrandExtractor` pulls company, products, audience, tone, logo, and images, each with the snippet it came from. The user edits and saves the brief, confirms rights on each asset, and picks an avatar. Step 5 of onboarding is a note that official account connection is Phase 2. The step number is stored on the workspace.
4. Chat: `handleUserMessage` parses the text. A video request stores a plan and an itemized `estimateClipCost` (script, frames, video, voice, total). Nothing is generated until `generateFromMessage` runs from the Generate button.
5. Generate: `generateVideo` compares the estimate with the remaining monthly budget, inserts a `generating` row, and runs the three scenes with `Promise.all` through `FALLBACK_CHAIN` for the chosen tier. Each attempt is inserted. On full success the router writes a stitched manifest (ordered scenes, duration, caption track, hook) and `cost_actual_usd`. On failure the video is `failed` and the cost stays 0.
6. Approval: `canApprove` requires a privacy value, music consent, and schedule consent. Commercial disclosure requires a type. Clearing the AI label requires `confirmAiOff`. `approveVideo` writes the approval JSON and the audit row.
7. Schedule: the user picks a datetime or the next 09:00 / 12:00 / 18:00. Only an approved video can be queued. `POST /api/cron/tick` (Bearer `CRON_SECRET`) calls `processDueItems`, which sets due rows to `due_manual`.

Stripe checkout is `POST /api/billing/checkout`. It creates a test-mode Checkout Session when `STRIPE_SECRET_KEY` is an `sk_test_` key and the price id is set. Otherwise it marks the workspace plan in the database and tells the UI the upgrade was simulated. `POST /api/billing/webhook` verifies the signature with `STRIPE_WEBHOOK_SECRET`.

Both machine endpoints fail closed. With `CRON_SECRET` or `STRIPE_WEBHOOK_SECRET` unset they return 401, unless `ALLOW_INSECURE_LOCAL_ENDPOINTS=1` and `NODE_ENV` is not `production` (`src/lib/local-mode.ts`).

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
