# Engineering standards

These are the rules every change to Torq-Pamba is held to. Reviewers block on them. Tests enforce many of them, and the test that does is named where one exists.

## 1. Tests gate every commit

- Before every commit, run `npm run typecheck && npm run lint && npm test`, then `CI=1 npm run test:e2e`. All of them must pass. Never commit untested code.
- Never weaken, skip, or delete an existing test to get green. If a product rule changes on purpose (for example "cron fails closed" replacing "cron is open without a secret"), change the test in the same commit and say why in the commit message.
- New behavior ships with real tests: unit tests for the rule in `src/lib`, plus an e2e path when a user can see it. No padding (no tests that only assert a constant exists).
- Unit tests run on in-memory PGlite with `PROVIDER_MODE=mock` and no network. A test that needs the network stubs `fetch` and asserts the calls it made.

## 2. Mock is the default; live is opt-in

- `PROVIDER_MODE=mock` and `PUBLISH_MODE=mock` are the defaults. Live vendor or platform calls need the mode flag **and** the key **and** `NODE_ENV !== "test"` (`isLive`, `isPublishLive`).
- No paid API key is required to build, test, or demo the app.
- Live clip adapters implement `submitClip` + `pollClip` and run through the job runner (`src/lib/jobs`), which downloads the output into media assets and renders the MP4. A "started" job is not a finished clip.

## 3. Fail closed

- Endpoints that act without a user session must be authenticated by a secret, and must refuse (401) when that secret is unset, except in explicit local mode (`ALLOW_INSECURE_LOCAL_ENDPOINTS=1`, never in production): `POST /api/cron/tick` (`CRON_SECRET`), `POST /api/billing/webhook` (`STRIPE_WEBHOOK_SECRET`, signature checked). See `src/lib/local-mode.ts`, `src/lib/endpoint-auth.test.ts` and `src/lib/security/fail-closed.test.ts`.
- In production, missing `TOKEN_ENCRYPTION_KEY` or `OAUTH_STATE_SECRET` throws instead of falling back to a dev key.
- Media is served only by unguessable key (`isMediaKey`), never by path.

## 4. Secrets

- No secret in the tree, ever. `.env.example` keeps every value empty. `.env*` (except the example), `.data/`, build output and Playwright output are gitignored.
- OAuth tokens are sealed with AES-256-GCM before they reach the database and wiped on disconnect. Mock accounts hold no credential.
- Stripe is test mode only. `sk_live_` keys throw. Turning on live billing is a human decision outside this repo.

## 5. Platform rules

- Official APIs only. Publish endpoints may appear only under `src/lib/publish/live/`, and only `dispatch.ts`, `accounts.ts` and `lib/analytics` may import that folder (`schedule.test.ts` scans for both).
- Never post from devices. No device or SIM farms, account creation, warming, account trading, ban evasion, or AI-provenance metadata stripping. These are out of scope permanently.
- AI disclosure is on by default and is sent to every platform that supports a flag (`is_aigc`, `is_ai_generated`). Turning it off takes an explicit confirmation and an audit row.
- Until TikTok passes the Content Posting audit (`TIKTOK_AUDITED=1`), TikTok posts are forced to `SELF_ONLY` and capped at 5 creators per 24 hours. Branded content cannot be private.
- Only approved videos can be scheduled or published, and only to accounts the workspace connected.

## 6. Money

- Estimate before generating. Check the budget before spending. Charge only on success; failed attempts cost the customer nothing.
- Every spend, approval, disclosure change, schedule change, publish result and plan change writes `audit_log`.

## 7. Code

- TypeScript strict, `tsc --noEmit` and ESLint clean. No `any` without a comment explaining why.
- Business rules live in `src/lib` and are unit-testable without rendering. UI uses accessible names (`label`, `role`) so e2e can use `getByRole`.
- Schema changes ship with a generated migration in `./drizzle` (`npm run db:generate -- --name <change>`).
- External API shapes that were not verified against live docs are marked `unverified` in code and listed in REPORT.md.

## 8. Releases

- Work lands on a branch. Pushing, merging, tagging and deploying need the operator's explicit yes.
