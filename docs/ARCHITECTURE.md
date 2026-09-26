# Architecture

Torq-Pamba is a Next.js App Router app. Pages and server actions handle HTTP. Rules that must be tested without a browser live in `src/lib`. Drizzle talks to Postgres when `DATABASE_URL` is set, and to embedded PGlite otherwise.

## Modules

| Module | Responsibility |
|---|---|
| `src/app` | Routes. Public site (`/`, `/terms`, `/privacy`, `/login`, `/signup`, `/demo-site`), invite acceptance (`/invite/[token]`), studio (`/app` and children), and three route handlers |
| `src/components` | Forms and panels: onboarding, avatars, chat, preview player, approval, schedule, public chrome |
| `src/lib/auth` | Email and scrypt password, session cookie `tp_session` (httpOnly, SameSite=Lax), `requireUser` and `requireWorkspace` |
| `src/lib/onboarding` | Fetch a public page, extract a brand profile, save the brief, import assets, record rights |
| `src/lib/avatars` | Eight stock SVG avatars, niche shortlist, text-to-portrait generation, workspace exclusivity |
| `src/lib/agent` | Turn a chat message into a plan, a schedule command, or a queue listing |
| `src/lib/pricing` and `src/lib/router` | Tier prices, fallback chains, parallel scene generation, stitch, budget cap, charge on success |
| `src/lib/providers` | Vendor adapters and the mock provider |
| `src/lib/approval.ts` | The gate. Privacy has no default. Consents start unchecked. The AI label starts on |
| `src/lib/schedule.ts` | Slots at 09:00, 12:00, and 18:00 in the workspace timezone. `processDueItems` sets `due_manual`. There is no publish function |
| `src/lib/billing.ts` | Free / Creator / Studio as placeholder test-mode plans. Refuses `sk_live_` |
| `src/db` | Schema and `getDb()` |

`getDb()` stores its promise on `globalThis` so Next.js dev reload does not open PGlite twice, and it runs the SQL in `./drizzle` on first use. `PGLITE_DIR=memory` keeps the database in memory. `next.config.ts` lists `@electric-sql/pglite` in `serverExternalPackages`. Routes that use the database set `dynamic = "force-dynamic"` so `next build` does not connect.

Provider calls go through `isLive`. That is true only when `PROVIDER_MODE=live`, the adapter’s key is set, and `NODE_ENV` is not `test`. Otherwise `generateClip` returns deterministic SVG frames from `mock.ts`. A prompt containing `[refuse]` makes the mock video provider throw `ProviderRefusedError` on the first attempt for that scene and succeed on the next, so one step of the fallback chain can be exercised. `[refuse-all]` refuses every attempt.

Live chat, when enabled, tries Anthropic (Claude Sonnet 5), then xAI (Grok 4.7), then Google (Gemini 3.8 Flash). The mock agent does not need a model: `parse.ts` reads the utterance and `plan.ts` fills a template from the brief.

## Data model

Defined in `src/db/schema.ts`. Money columns are `numeric(12, 2)`.

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

The status enum also includes `draft` and `planned`. The chat path inserts the row as `generating`, then sets `ready` or `failed`. Approval sets `approved`. Scheduling sets the video to `scheduled` and inserts a `schedule_items` row. The cron tick does not add another video status; it moves the schedule row to `due_manual`.

## Request flow

1. The browser loads a server component. `requireWorkspace` reads `tp_session` and the membership.
2. A form posts to a server action. The action checks the session, calls a `src/lib` function, and redirects or returns a small result.
3. Onboarding: `fetchSite` downloads HTML, `getBrandExtractor` pulls company, products, audience, tone, logo, and images, each with the snippet it came from. The user edits and saves the brief, confirms rights on each asset, and picks an avatar. Step 5 of onboarding is a note that official account connection is Phase 2. The step number is stored on the workspace.
4. Chat: `handleUserMessage` parses the text. A video request stores a plan and an itemized `estimateClipCost` (script, frames, video, voice, total). Nothing is generated until `generateFromMessage` runs from the Generate button.
5. Generate: `generateVideo` compares the estimate with the remaining monthly budget, inserts a `generating` row, and runs the three scenes with `Promise.all` through `FALLBACK_CHAIN` for the chosen tier. Each attempt is inserted. On full success the router writes a stitched manifest (ordered scenes, duration, caption track, hook) and `cost_actual_usd`. On failure the video is `failed` and the cost stays 0.
6. Approval: `canApprove` requires a privacy value, music consent, and schedule consent. Commercial disclosure requires a type. Clearing the AI label requires `confirmAiOff`. `approveVideo` writes the approval JSON and the audit row.
7. Schedule: the user picks a datetime or the next 09:00 / 12:00 / 18:00. Only an approved video can be queued. `POST /api/cron/tick` (Bearer `CRON_SECRET` when that variable is set) calls `processDueItems`, which sets due rows to `due_manual`.

Stripe checkout is `POST /api/billing/checkout`. It creates a test-mode Checkout Session when `STRIPE_SECRET_KEY` is an `sk_test_` key and the price id is set. Otherwise it marks the workspace plan in the database and tells the UI the upgrade was simulated. `POST /api/billing/webhook` checks `STRIPE_WEBHOOK_SECRET` when that variable is set.

The monthly budget sums `generation_attempts.cost_usd` for rows with status `ok` since the start of the month in the workspace timezone.
