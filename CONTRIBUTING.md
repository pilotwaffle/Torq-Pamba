# Contributing

Torq-Pamba makes videos, requires approval, schedules them, and (from Phase 2) publishes them through official TikTok, Instagram and Facebook APIs to accounts the customer connected. Read [STANDARDS.md](STANDARDS.md) first. Changes that add a posting path outside `src/lib/publish/live/`, a device farm, account trading, or a way to strip AI-provenance metadata will not be accepted.

## Setup

Node 24 (CI’s version; `package.json` allows Node 22 or newer).

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` copies `.env.example` to `.env.local` when `.env.local` is missing, then applies the SQL in `./drizzle`. Leave secrets empty. The app runs on the mock provider, embedded PGlite under `./.data/pglite`, and simulated Stripe.

Do not commit `.env`, `.env.local`, `node_modules/`, `.next/`, `.data/`, `package-lock.json`, Playwright output, or TypeScript build info. Those paths are gitignored. `.env.example` is the exception and stays in the tree, with empty values.

Open http://localhost:3000 and onboard http://localhost:3000/demo-site to walk the product without keys.

## Scripts

| Script | Use it when |
|---|---|
| `npm run dev` | Local UI on port 3000 |
| `npm run build` / `npm run start` | Production build. E2E starts this on port 3100 |
| `npm run lint` | Before you finish. ESLint 9, flat config, `eslint .` |
| `npm run typecheck` | Before you finish. `tsc --noEmit` |
| `npm test` | Unit tests. Forces in-memory PGlite and clears `DATABASE_URL` |
| `npm run test:e2e` | Browser journey. Needs Playwright’s Chromium (`npx playwright install --with-deps chromium` on a fresh machine) |
| `npm run capture` | Regenerates `docs/images/*.png` and `docs/media/demo.webm` from the real UI |
| `bash scripts/make-media.sh` | Builds `docs/media/demo.mp4` and `demo.gif` from that WebM |
| `npm run db:generate` | After a schema change. Commit the new files under `./drizzle` |
| `npm run db:migrate` | Apply migrations to the database selected by the environment |
| `npm run setup` | First-time env file plus migrate |

## Code layout

Business rules live in `src/lib` so unit tests can call them without rendering a page. UI lives in `src/app` and `src/components`. Server actions sit next to the rule they call (`src/lib/auth/actions.ts`, `src/lib/onboarding/actions.ts`, and the other `*-actions.ts` modules). HTTP endpoints that are not form actions are route handlers under `src/app/api`.

| Path | Role |
|---|---|
| `src/app/(public pages)` | `/`, `/terms`, `/privacy`, `/login`, `/signup`, `/demo-site`, `/invite/[token]` |
| `src/app/app/` | Signed-in studio: dashboard, onboarding, brief, avatars, chat, videos, schedule, billing, settings |
| `src/app/api/billing/` | `POST /api/billing/checkout`, `POST /api/billing/webhook` |
| `src/app/api/cron/tick/` | `POST /api/cron/tick` moves due rows to `due_manual` |
| `src/components/app-shell/` | Sidebar nav entries and sidebar widgets as config arrays |
| `src/components/` | Studio UI. Prefer accessible names (`label`, `role`) so Playwright can use `getByRole` and `getByLabel` |
| `src/db/schema/` | Drizzle tables, one file per domain, re-exported from `index.ts`. Enums in `enums.ts` |
| `src/db/index.ts` | `getDb()`, memoized on `globalThis`, migrates once |
| `src/lib/onboarding/` | Fetch, extract, brief, assets, rights |
| `src/lib/agent/` | Chat tools (`tools/`, one file each, listed in `tools/all.ts`), plan, chat turn |
| `src/lib/router.ts` | Budget check, parallel scenes, fallback, stitch, charge-on-success |
| `src/lib/models/` | Per-model catalog, one file per vendor: list price and its source, tier, fallback position |
| `src/lib/pricing.ts` | `TIER_MODEL`, `FALLBACK_CHAIN`, and `estimateClipCost`, derived from the catalog |
| `src/lib/providers/` | One adapter file per vendor, listed in `adapters.ts`, plus `mock.ts`, `live.ts`, `catalog.ts`, `registry.ts` |
| `src/lib/approval.ts` | Gate rules. Approve is impossible until the draft is complete |
| `src/lib/schedule.ts` | Slots and `processDueItems`. Hands targeted items to `src/lib/publish/queue.ts` |
| `src/lib/publish/` | Accounts, OAuth, rules, mock publisher, queue, dispatch. Official endpoints live only in `live/` |
| `src/lib/media/` | Clip storage and ffmpeg stitching |
| `src/lib/analytics/` | Post metric snapshots |
| `src/lib/reach/` | Hook tests, Knowledge tiles, ad hand-offs, creator briefs |
| `src/lib/platform/` | API keys and OAuth grants, REST v1, MCP server, OAuth 2.1 authorization server |
| `src/lib/tools/` | Pure logic for the free public tools |
| `src/lib/billing.ts` | Plans and Stripe test mode |
| `e2e/` | `support/` (steps, `account` fixture, journey), `core/` (journey, fallback, shell, capture), and one folder per feature |
| `drizzle/` | Committed SQL migrations |
| `scripts/` | `setup.mjs`, `migrate.ts`, `make-media.sh` |

Pages and routes that read or write the database export `dynamic = "force-dynamic"`.

## Review criteria

A change has to keep these properties true. They are tested.

1. **Publishing only through official APIs, behind gates.** TikTok Content Posting (`open.tiktokapis.com/v2/post/publish`), Instagram `media_publish` and Facebook `video_reels` appear only under `src/lib/publish/live/`, which only the dispatcher, account linking and analytics may import (both rules are tested in `src/lib/schedule.test.ts`). A post needs an approved video, a connected account the customer owns, and `PUBLISH_MODE=live`; otherwise the mock publisher runs. Due rows without targets still become `due_manual`. TikTok posts stay `SELF_ONLY`, at most 5 creators per 24 hours, until `TIKTOK_AUDITED=1`. Never post from devices or managed accounts. (This replaced the original "No publishing" criterion when phase 2 landed.)
2. **AI disclosure on by default.** New videos start with `aiGenerated: true`. Turning the label off requires an explicit confirmation and an `audit_log` row. The workspace default works the same way.
3. **No farm, warming, account market, or metadata stripping.** Do not add device or SIM control, account creation for a customer, warming, buying or selling accounts, re-creating a banned account, or a tool that removes AI-provenance metadata. The terms already forbid these.
4. **Stripe test mode only.** `assertTestMode` must keep throwing when `STRIPE_SECRET_KEY` starts with `sk_live_`. Missing key means a simulated upgrade that the UI labels as simulated.
5. **Mock unless live and keyed.** `isLive` is false unless `PROVIDER_MODE=live`, the vendor key is non-empty, and `NODE_ENV` is not `test`. New adapters use that guard. Tests do not call vendor hosts.

Also keep, when you touch the area: onboarding fetches are http/https only, time out at 8 seconds, cap the body at 1.5 MB, and block private IPs in production unless `ALLOW_LOCAL_ONBOARDING=1`. Assets cannot be used until rights are confirmed. The monthly budget cap (default $25) refuses an estimate that exceeds the remainder, and failed generations record $0.

## Adding a provider adapter

Adapters implement the interfaces in `src/lib/providers/types.ts`. Video:

```ts
interface VideoProvider {
  id: string;
  vendor: string;
  label: string;
  tier: Tier;
  pricePerSecondUsd: number;
  maxDurationS: number;
  generateClip(req: ClipRequest): Promise<ClipResult>;
}
```

1. Add `src/lib/providers/<vendor>.ts`. Build the request in a pure function the unit tests can call without the network. Put the live `fetch` behind `isLive(["YOUR_API_KEY"])` from `live.ts`. When that returns false, return `mockGenerateClip` (or `mockGenerateImage`). For a catalog-priced video model, `catalogVideoProvider(id, { envKeys, live })` from `catalog.ts` does both.
2. Map HTTP 400 and 422, and safety-filter responses, to `ProviderRefusedError`. Map other failures and timeouts to `ProviderUnavailableError`. The router treats both as “try the next model” and records the attempt.
3. Export `adapter = defineAdapter({ id: "<vendor>", video: [...], image: [...], llm: [...] })` from the file and add one line to `adapters.ts`. Do not edit `registry.ts`.
4. Add the model to `src/lib/models/<vendor>.ts` (and one line in `models/vendors.ts` for a new vendor) with `source` citing the vendor page and the date you read it. If the model belongs on a chain, give it `chains: { <tier>: <position> }`; a fractional position slots between existing models. Do not invent a price.
5. Document the key in `.env.example` (empty value, one comment line) and in the environment table in `README.md`.
6. Test the request builder, the price, and, if the id is on a chain, a refusal. The mock provider refuses when the prompt contains `[refuse]`. Do not hit the vendor from Vitest or Playwright.

Live helpers (`postJson`, `getJson`, `pollUntil`) already bound the call. Keep new live code to request shape, submit, and poll. Kling Avatar and HeyGen Avatar IV are registered this way and are not on the default chat chains; follow that pattern if the model is an alternative rather than a tier default.

## Commit style

Match the existing history: one imperative sentence, sentence case, no type prefix.

```
Scheduling queue (no publishing), Stripe test-mode billing, marketing page, ToS and privacy
```

Say what changed for a user or for the module. Leave the subject under about 72 characters when you can. Do not commit generated lockfiles, env files, or Playwright reports.

## Tests required

Before you open a change:

- `npm run lint`
- `npm run typecheck`
- `npm test`

Add or extend a Vitest file next to the module when you change pricing, the router, approval, scheduling, billing, auth, or onboarding. The forbidden-endpoint scan in `src/lib/schedule.test.ts` must stay, and it must still fail the suite if those strings appear under `src/`.

Run `npm run test:e2e` when you change a page, a form, or a flow the e2e specs cover (signup, onboarding, chat, approval, schedule, publishing, reach, API keys, OAuth consent, free tools). A new feature adds its own `e2e/<feature>/*.spec.ts` using `test` from `e2e/support`, rather than extending the core journey. If you change what a screenshot shows, regenerate with `npm run capture` and `bash scripts/make-media.sh`.

If you add a REST route or an MCP tool, put the logic in `src/lib/platform/operations.ts` so both surfaces share it, and extend `src/lib/platform/platform.test.ts`. Never store a raw key or token; store `hashSecret(...)`.

If you add a migration, generate it with `npm run db:generate` and commit `./drizzle`. Do not hand-edit a snapshot to skip a column the schema declares.
