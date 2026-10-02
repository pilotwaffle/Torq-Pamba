import { pgEnum } from "drizzle-orm/pg-core";

// Every enum lives here so table files can import them eagerly without
// import cycles. Table-to-table references are lazy (`() => table.id`).

export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
/** Legacy plan column. New code reads `workspaces.plan_id` (see `plans`). */
export const workspacePlan = pgEnum("workspace_plan", ["free", "creator", "studio"]);
export const videoStatus = pgEnum("video_status", [
  "draft",
  "planned",
  "generating",
  "ready",
  "approved",
  "scheduled",
  "failed",
]);
export const videoTier = pgEnum("video_tier", ["budget", "standard", "premium"]);
export const attemptStatus = pgEnum("attempt_status", ["ok", "refused", "error"]);
/** `publishing`, `published` and `publish_failed` are reserved for wave 2 official-API publishing. */
export const scheduleStatus = pgEnum("schedule_status", [
  "scheduled",
  "due_manual",
  "canceled",
  "publishing",
  "published",
  "publish_failed",
]);

export const mediaKind = pgEnum("media_kind", ["video", "image", "audio", "captions"]);
export const mediaSource = pgEnum("media_source", ["upload", "generated", "render", "import"]);
/** inline = data: URL in `url`; local = disk path in `storage_key`; s3 = S3-compatible bucket key (S3, R2); external = remote URL we did not copy. */
export const storageDriver = pgEnum("storage_driver", ["inline", "local", "s3", "external"]);

export const jobKind = pgEnum("job_kind", ["clip", "image", "voice", "voice_clone", "lipsync", "render"]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "submitted",
  "running",
  "succeeded",
  "failed",
  "refused",
  "canceled",
  "timed_out",
]);
export const takeStatus = pgEnum("take_status", ["pending", "generating", "ready", "failed"]);
export const renderStatus = pgEnum("render_status", ["queued", "rendering", "ready", "failed"]);
export const contentSource = pgEnum("content_source", ["ai", "user"]);

export const toolCallStatus = pgEnum("tool_call_status", [
  "pending",
  "awaiting_confirmation",
  "running",
  "succeeded",
  "failed",
  "rejected",
]);

export const voiceKind = pgEnum("voice_kind", ["stock", "clone"]);
export const voiceCloneStatus = pgEnum("voice_clone_status", [
  "awaiting_consent",
  "processing",
  "ready",
  "failed",
  "revoked",
]);

export const socialPlatform = pgEnum("social_platform", ["tiktok", "instagram", "facebook", "youtube"]);
export const inspirationKind = pgEnum("inspiration_kind", ["inspiration", "competitor"]);
export const trendKind = pgEnum("trend_kind", ["hashtag", "sound", "format", "topic"]);
export const ideaStatus = pgEnum("idea_status", ["new", "saved", "used", "dismissed"]);
export const ideaSource = pgEnum("idea_source", ["agent", "user", "viral_post", "trend"]);

export const billingInterval = pgEnum("billing_interval", ["month", "year"]);
export const creditEntryKind = pgEnum("credit_entry_kind", [
  "signup_grant",
  "plan_grant",
  "top_up",
  "generation_charge",
  "refund",
  "adjustment",
  "expiry",
]);
export const topUpStatus = pgEnum("top_up_status", ["pending", "paid", "failed", "refunded"]);
/** Credits are reserved before a job starts, captured on success, released on failure (never charge failures). */
export const chargeStatus = pgEnum("charge_status", ["reserved", "captured", "released"]);
export const chargeKind = pgEnum("charge_kind", [
  "script",
  "clip",
  "image",
  "voice",
  "voice_clone",
  "lipsync",
  "render",
]);

export const connectionStatus = pgEnum("connection_status", ["active", "expired", "revoked", "error"]);
/** Phase 2 publish queue (`publish_jobs`). */
export const publishJobStatus = pgEnum("publish_job_status", ["queued", "processing", "succeeded", "failed", "canceled"]);
export const publishStatus = pgEnum("publish_status", ["pending", "submitted", "published", "failed", "canceled"]);
export const knowledgeKind = pgEnum("knowledge_kind", ["brand_fact", "preference", "learning", "hook_result", "rule"]);
export const knowledgeSource = pgEnum("knowledge_source", ["user", "agent", "analytics"]);
