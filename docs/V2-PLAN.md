# V2 plan

V2 moves Torq-Pamba from planned mock clips toward Pamba-style output: real rendered video, a tool-calling agent, voices, an editor, research, and credits. The work runs in waves so several agents can build at once without editing the same lines.

## Wave 0: foundation (done)

One branch, no features. It adds:

- Migration `drizzle/0001_v2_foundation.sql` with every v2 table, column, enum, foreign key, and index, plus the seeded `plans` rows. The tables are listed under Data model in `docs/ARCHITECTURE.md`.
- The extension points in "How to add a feature" in `docs/ARCHITECTURE.md`: the model catalog, the provider adapter registry, the chat tool registry, the nav and sidebar config arrays, and the e2e support layout.
- Fail-closed machine endpoints: `/api/cron/tick` and `/api/billing/webhook` return 401 when their secret is unset, unless `ALLOW_INSECURE_LOCAL_ENDPOINTS=1` outside production.

Wave 1 should not need another migration. If a feature does need one, generate it on that branch and expect to renumber it when rebasing after another feature's migration merges.

## Wave 1: features a to f, in parallel

Each feature owns the files listed for it. Shared lists take one added entry per feature. Every feature keeps mock mode working with no keys, and adds unit tests next to its module and an `e2e/<feature>/` spec that uses the `account` fixture.

| | Feature | Tables (already migrated) | Owns | Plugs into |
|---|---|---|---|---|
| a | Real video output: submit and poll provider jobs, store clips, stitch a final MP4, user media uploads in onboarding | `generation_jobs`, `media_assets`, `video_renders`, `assets.media_asset_id`, `videos.current_render_id`, `generation_attempts.job_id` | `src/lib/router.ts`, new `src/lib/media/` and `src/lib/jobs/`, the cron tick's job polling, the onboarding media step | Adapters return a provider job id instead of finished frames. A `render` provider kind through `ProviderKinds` |
| b | Tool-calling chat agent: a live model loop with tool calls and results, confirmation before anything that spends | `conversations`, `chat_tool_calls`, `chat_messages.conversation_id`, token columns | `src/lib/agent/run.ts`, `src/components/chat-thread.tsx`, the chat page | `chatTools.definitions()` for the model, `chatTools.run(name, ctx, args)` to execute. Other features add tools in `src/lib/agent/tools/` |
| c | Voices: stock catalog, user voice clones with recorded consent, a voice per avatar, lip-sync jobs | `voices`, `voice_clones`, `voice_clone_samples`, `avatars.tts_voice_id`, `avatars.lipsync_model`, `scene_takes.lipsync_job_id` | New `src/lib/voices/`, the avatar studio voice controls | `voice` and `lipsync` provider kinds through `ProviderKinds`; voice models in `src/lib/models/elevenlabs.ts`; jobs in `generation_jobs` with kind `voice`, `voice_clone`, or `lipsync` |
| d | Editor: scenes with multiple takes and a selected take, editable captions and hooks, regenerate one scene | `video_scenes`, `scene_takes`, `video_captions`, `video_hooks` | New `src/lib/editor/`, an editor route under `src/app/app/videos/[id]/` | Regenerating a take goes through feature a's job path; a `regenerate-scene` chat tool |
| e | Research: tracked inspiration and competitor accounts, viral posts, trends, ideas that seed a plan | `inspiration_accounts`, `viral_posts`, `trends`, `ideas`, `videos.idea_id` | New `src/lib/research/`, `src/app/app/research/` | One `NAV_ITEMS` entry; `find-trends` and `ideas` chat tools. Sources are official APIs or user-entered data, with a mock source for keyless runs |
| f | Pamba-style credits: Hobby $16/mo with 1,600 credits and Pro $100/mo with 10,000, a ledger, top-ups, a charge per generation | `plans`, `credit_ledger`, `credit_top_ups`, `credit_charges`, `workspaces.plan_id`, `credit_balance`, `videos.credits_charged` | `src/lib/billing.ts`, new `src/lib/credits/`, the billing page | `credits` on each catalog model entry; one `SIDEBAR_WIDGETS` entry for the balance. Reserve before a job, capture on success, release on failure, so failures cost nothing |

### Remaining hotspots

These files sit on more than one feature's path. The owner named first edits them; others wait for that merge, or keep their change to a single call.

- `src/lib/router.ts`: a owns it. f adds the reserve, capture, and release calls around the existing charge-on-success step. c adds the voice and lip-sync steps after a merges.
- `src/app/app/videos/[id]/page.tsx`: shared by review, approval, and the editor. d owns it; a adds the rendered MP4 player through a component d imports.
- The onboarding flow (`src/components/onboarding-flow.tsx`, `src/lib/onboarding/`): a adds uploads to the media step, c may add a voice step. Steps are not yet a config array, so coordinate.
- `src/lib/agent/plan.ts`: b and d both read the plan shape. Extend `VideoPlan` with optional fields only.
- `.env.example` and the README environment table: append-only, one line per key.

## Wave 2

Starts after wave 1 merges.

1. **Publishing through official APIs.** Uses `publishing_connections` (OAuth tokens stored encrypted, `token_key_version` for rotation) and `publish_attempts` (`ai_disclosure` default true). This reverses review criterion 1 in `CONTRIBUTING.md` and the forbidden-endpoint scan in `src/lib/schedule.test.ts`. That change needs an explicit owner decision and has to land with updated criteria and tests. The approval gate, the AI label, and per-post consent stay. Real-device posting and managed accounts stay out of scope.
2. **Analytics and the learning loop.** `post_analytics_snapshots` stores metrics from the official APIs. `knowledge_items` stores what worked (hooks, formats, brand facts, preferences), which feeds the plan tool and the agent's context.
3. **REST API and MCP server.** `api_keys` stores a hash and a display prefix, with scopes, a read-only flag, and a credit ceiling. The REST API and the MCP server expose the same chat tools through `chatTools.definitions()` and `chatTools.run`, so there is one implementation of each action.

## Never

Real-device posting, device or SIM farms, account warming, managed or purchased accounts, and stripping AI-provenance metadata. See `CONTRIBUTING.md`.
