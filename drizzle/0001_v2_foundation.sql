CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('script', 'clip', 'image', 'voice', 'voice_clone', 'lipsync', 'render');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('reserved', 'captured', 'released');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."content_source" AS ENUM('ai', 'user');--> statement-breakpoint
CREATE TYPE "public"."credit_entry_kind" AS ENUM('signup_grant', 'plan_grant', 'top_up', 'generation_charge', 'refund', 'adjustment', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."idea_source" AS ENUM('agent', 'user', 'viral_post', 'trend');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'saved', 'used', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."inspiration_kind" AS ENUM('inspiration', 'competitor');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('clip', 'image', 'voice', 'voice_clone', 'lipsync', 'render');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'submitted', 'running', 'succeeded', 'failed', 'refused', 'canceled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."knowledge_kind" AS ENUM('brand_fact', 'preference', 'learning', 'hook_result', 'rule');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source" AS ENUM('user', 'agent', 'analytics');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('video', 'image', 'audio', 'captions');--> statement-breakpoint
CREATE TYPE "public"."media_source" AS ENUM('upload', 'generated', 'render', 'import');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('pending', 'submitted', 'published', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."render_status" AS ENUM('queued', 'rendering', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('tiktok', 'instagram', 'facebook', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."storage_driver" AS ENUM('inline', 'local', 's3', 'external');--> statement-breakpoint
CREATE TYPE "public"."take_status" AS ENUM('pending', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('pending', 'awaiting_confirmation', 'running', 'succeeded', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."top_up_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."trend_kind" AS ENUM('hashtag', 'sound', 'format', 'topic');--> statement-breakpoint
CREATE TYPE "public"."voice_clone_status" AS ENUM('awaiting_consent', 'processing', 'ready', 'failed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."voice_kind" AS ENUM('stock', 'clone');--> statement-breakpoint
ALTER TYPE "public"."schedule_status" ADD VALUE 'publishing';--> statement-breakpoint
ALTER TYPE "public"."schedule_status" ADD VALUE 'published';--> statement-breakpoint
ALTER TYPE "public"."schedule_status" ADD VALUE 'publish_failed';--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"video_id" uuid,
	"kind" "job_kind" NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"provider_job_id" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"error" text,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"output_asset_id" uuid,
	"cost_usd" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"source" "media_source" NOT NULL,
	"storage" "storage_driver" NOT NULL,
	"storage_key" text,
	"url" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"sha256" text,
	"original_filename" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_size_check" CHECK ("media_assets"."size_bytes" IS NULL OR "media_assets"."size_bytes" >= 0),
	CONSTRAINT "media_assets_duration_check" CHECK ("media_assets"."duration_ms" IS NULL OR "media_assets"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "video_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"status" "render_status" DEFAULT 'queued' NOT NULL,
	"job_id" uuid,
	"output_asset_id" uuid,
	"poster_asset_id" uuid,
	"duration_ms" integer,
	"manifest" jsonb,
	"captions_burned_in" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scene_takes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "take_status" DEFAULT 'pending' NOT NULL,
	"provider" text,
	"model" text,
	"prompt" text DEFAULT '' NOT NULL,
	"job_id" uuid,
	"clip_asset_id" uuid,
	"poster_asset_id" uuid,
	"voice_asset_id" uuid,
	"lipsync_job_id" uuid,
	"lipsync_asset_id" uuid,
	"duration_ms" integer,
	"cost_usd" numeric(12, 2) DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_captions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"scene_id" uuid,
	"position" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"source" "content_source" DEFAULT 'ai' NOT NULL,
	"style" jsonb,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_captions_range_check" CHECK ("video_captions"."start_ms" >= 0 AND "video_captions"."end_ms" >= "video_captions"."start_ms")
);
--> statement-breakpoint
CREATE TABLE "video_hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"source" "content_source" DEFAULT 'ai' NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"end_ms" integer,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"visual" text DEFAULT '' NOT NULL,
	"line" text DEFAULT '' NOT NULL,
	"duration_ms" integer NOT NULL,
	"selected_take_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_scenes_duration_check" CHECK ("video_scenes"."duration_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "chat_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid NOT NULL,
	"result_message_id" uuid,
	"call_id" text,
	"tool_name" text NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "tool_call_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"cost_usd" numeric(12, 2) DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"title" text DEFAULT '' NOT NULL,
	"model" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_clone_samples" (
	"clone_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_clone_samples_clone_id_asset_id_pk" PRIMARY KEY("clone_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "voice_clones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"voice_id" uuid,
	"name" text NOT NULL,
	"status" "voice_clone_status" DEFAULT 'awaiting_consent' NOT NULL,
	"speaker_name" text NOT NULL,
	"consent_statement" text,
	"consent_asset_id" uuid,
	"consented_by" uuid,
	"consented_at" timestamp with time zone,
	"provider" text,
	"job_id" uuid,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"kind" "voice_kind" NOT NULL,
	"provider" text NOT NULL,
	"provider_voice_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"accent" text,
	"description" text,
	"preview_url" text,
	"is_premium" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"hook" text,
	"angle" text,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"source" "idea_source" DEFAULT 'agent' NOT NULL,
	"viral_post_id" uuid,
	"trend_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspiration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"handle" text NOT NULL,
	"kind" "inspiration_kind" DEFAULT 'inspiration' NOT NULL,
	"display_name" text,
	"profile_url" text,
	"follower_count" bigint,
	"notes" text,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "social_platform",
	"kind" "trend_kind" NOT NULL,
	"label" text NOT NULL,
	"niche" text,
	"score" numeric(10, 2),
	"volume" bigint,
	"growth_pct" numeric(10, 2),
	"url" text,
	"data" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "viral_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid,
	"platform" "social_platform" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author_handle" text,
	"caption" text,
	"hook" text,
	"transcript" text,
	"thumbnail_url" text,
	"duration_ms" integer,
	"posted_at" timestamp with time zone,
	"views" bigint,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"outlier_score" numeric(10, 2),
	"data" jsonb,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" charge_kind NOT NULL,
	"status" charge_status DEFAULT 'reserved' NOT NULL,
	"video_id" uuid,
	"job_id" uuid,
	"take_id" uuid,
	"tool_call_id" uuid,
	"model" text,
	"units" numeric(14, 3) DEFAULT 0 NOT NULL,
	"credits" integer NOT NULL,
	"cost_usd" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "credit_charges_credits_check" CHECK ("credit_charges"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "credit_entry_kind" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"plan_id" text,
	"top_up_id" uuid,
	"charge_id" uuid,
	"idempotency_key" text,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "credit_ledger_delta_check" CHECK ("credit_ledger"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "credit_top_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "top_up_status" DEFAULT 'pending' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "credit_top_ups_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "credit_top_ups_amount_check" CHECK ("credit_top_ups"."credits" > 0 AND "credit_top_ups"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"monthly_price_cents" integer NOT NULL,
	"yearly_price_cents" integer,
	"monthly_credits" integer NOT NULL,
	"signup_credits" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_amounts_check" CHECK ("plans"."monthly_price_cents" >= 0 AND "plans"."monthly_credits" >= 0 AND "plans"."signup_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "post_analytics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publish_attempt_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" bigint,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"watch_time_ms" bigint,
	"avg_watch_pct" numeric(5, 2),
	"followers_gained" integer,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "publish_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"schedule_item_id" uuid,
	"connection_id" uuid,
	"render_id" uuid,
	"platform" "social_platform" NOT NULL,
	"status" "publish_status" DEFAULT 'pending' NOT NULL,
	"ai_disclosure" boolean DEFAULT true NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"external_post_id" text,
	"external_url" text,
	"error" text,
	"request" jsonb,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publishing_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text,
	"token_key_version" integer DEFAULT 1 NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"max_credits" integer,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "knowledge_kind" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" "knowledge_source" DEFAULT 'user' NOT NULL,
	"source_ref" jsonb,
	"video_id" uuid,
	"confidence" numeric(4, 3),
	"pinned" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "avatars" ADD COLUMN "tts_voice_id" uuid;--> statement-breakpoint
ALTER TABLE "avatars" ADD COLUMN "portrait_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "avatars" ADD COLUMN "lipsync_model" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "current_render_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "idea_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "credits_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan_id" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_interval" "billing_interval";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan_period_ends_at" timestamp with time zone;--> statement-breakpoint
-- Credit plans (Pamba-style: Hobby $16/mo for 1,600 credits, Pro $100/mo for 10,000).
-- Legacy workspaces.plan maps creator -> hobby and studio -> pro.
INSERT INTO "plans" ("id", "name", "monthly_price_cents", "monthly_credits", "signup_credits", "sort_order") VALUES
	('free', 'Free', 0, 0, 0, 0),
	('hobby', 'Hobby', 1600, 1600, 0, 1),
	('pro', 'Pro', 10000, 10000, 0, 2);--> statement-breakpoint
UPDATE "workspaces" SET "plan_id" = CASE "plan" WHEN 'creator' THEN 'hobby' WHEN 'studio' THEN 'pro' ELSE 'free' END;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_output_asset_id_media_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_output_asset_id_media_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_poster_asset_id_media_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_clip_asset_id_media_assets_id_fk" FOREIGN KEY ("clip_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_poster_asset_id_media_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_voice_asset_id_media_assets_id_fk" FOREIGN KEY ("voice_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_lipsync_job_id_generation_jobs_id_fk" FOREIGN KEY ("lipsync_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_takes" ADD CONSTRAINT "scene_takes_lipsync_asset_id_media_assets_id_fk" FOREIGN KEY ("lipsync_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_captions" ADD CONSTRAINT "video_captions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_captions" ADD CONSTRAINT "video_captions_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."video_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_captions" ADD CONSTRAINT "video_captions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_hooks" ADD CONSTRAINT "video_hooks_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_hooks" ADD CONSTRAINT "video_hooks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_selected_take_id_scene_takes_id_fk" FOREIGN KEY ("selected_take_id") REFERENCES "public"."scene_takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_result_message_id_chat_messages_id_fk" FOREIGN KEY ("result_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clone_samples" ADD CONSTRAINT "voice_clone_samples_clone_id_voice_clones_id_fk" FOREIGN KEY ("clone_id") REFERENCES "public"."voice_clones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clone_samples" ADD CONSTRAINT "voice_clone_samples_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_voice_id_voices_id_fk" FOREIGN KEY ("voice_id") REFERENCES "public"."voices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_consent_asset_id_media_assets_id_fk" FOREIGN KEY ("consent_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_consented_by_users_id_fk" FOREIGN KEY ("consented_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voices" ADD CONSTRAINT "voices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_viral_post_id_viral_posts_id_fk" FOREIGN KEY ("viral_post_id") REFERENCES "public"."viral_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_trend_id_trends_id_fk" FOREIGN KEY ("trend_id") REFERENCES "public"."trends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_accounts" ADD CONSTRAINT "inspiration_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_accounts" ADD CONSTRAINT "inspiration_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trends" ADD CONSTRAINT "trends_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viral_posts" ADD CONSTRAINT "viral_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viral_posts" ADD CONSTRAINT "viral_posts_account_id_inspiration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."inspiration_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_take_id_scene_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."scene_takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_tool_call_id_chat_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."chat_tool_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_top_up_id_credit_top_ups_id_fk" FOREIGN KEY ("top_up_id") REFERENCES "public"."credit_top_ups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_charge_id_credit_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."credit_charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_top_ups" ADD CONSTRAINT "credit_top_ups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_top_ups" ADD CONSTRAINT "credit_top_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_analytics_snapshots" ADD CONSTRAINT "post_analytics_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_analytics_snapshots" ADD CONSTRAINT "post_analytics_snapshots_publish_attempt_id_publish_attempts_id_fk" FOREIGN KEY ("publish_attempt_id") REFERENCES "public"."publish_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_connection_id_publishing_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."publishing_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_render_id_video_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."video_renders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_connections" ADD CONSTRAINT "publishing_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_connections" ADD CONSTRAINT "publishing_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_jobs_poll_idx" ON "generation_jobs" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_workspace_idx" ON "generation_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_video_idx" ON "generation_jobs" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_provider_job_idx" ON "generation_jobs" USING btree ("provider","provider_job_id");--> statement-breakpoint
CREATE INDEX "media_assets_workspace_idx" ON "media_assets" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_idx" ON "media_assets" USING btree ("storage","storage_key");--> statement-breakpoint
CREATE INDEX "video_renders_video_idx" ON "video_renders" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_takes_number_idx" ON "scene_takes" USING btree ("scene_id","number");--> statement-breakpoint
CREATE INDEX "scene_takes_job_idx" ON "scene_takes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "video_captions_video_idx" ON "video_captions" USING btree ("video_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "video_hooks_position_idx" ON "video_hooks" USING btree ("video_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "video_hooks_selected_idx" ON "video_hooks" USING btree ("video_id") WHERE "video_hooks"."is_selected";--> statement-breakpoint
CREATE UNIQUE INDEX "video_scenes_position_idx" ON "video_scenes" USING btree ("video_id","position");--> statement-breakpoint
CREATE INDEX "chat_tool_calls_message_idx" ON "chat_tool_calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_tool_calls_workspace_idx" ON "chat_tool_calls" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "conversations_workspace_idx" ON "conversations" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "voice_clones_workspace_idx" ON "voice_clones" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voices_provider_voice_idx" ON "voices" USING btree ("provider","provider_voice_id");--> statement-breakpoint
CREATE INDEX "voices_workspace_idx" ON "voices" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ideas_workspace_idx" ON "ideas" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inspiration_accounts_handle_idx" ON "inspiration_accounts" USING btree ("workspace_id","platform","handle");--> statement-breakpoint
CREATE INDEX "trends_workspace_idx" ON "trends" USING btree ("workspace_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "viral_posts_external_idx" ON "viral_posts" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "viral_posts_workspace_idx" ON "viral_posts" USING btree ("workspace_id","discovered_at");--> statement-breakpoint
CREATE INDEX "viral_posts_account_idx" ON "viral_posts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credit_charges_workspace_idx" ON "credit_charges" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_charges_video_idx" ON "credit_charges" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "credit_charges_job_idx" ON "credit_charges" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_idx" ON "credit_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_top_ups_workspace_idx" ON "credit_top_ups" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "post_analytics_attempt_idx" ON "post_analytics_snapshots" USING btree ("publish_attempt_id","captured_at");--> statement-breakpoint
CREATE INDEX "post_analytics_workspace_idx" ON "post_analytics_snapshots" USING btree ("workspace_id","captured_at");--> statement-breakpoint
CREATE INDEX "publish_attempts_workspace_idx" ON "publish_attempts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "publish_attempts_schedule_idx" ON "publish_attempts" USING btree ("schedule_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_attempts_external_idx" ON "publish_attempts" USING btree ("platform","external_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_connections_account_idx" ON "publishing_connections" USING btree ("workspace_id","platform","external_account_id");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_workspace_idx" ON "knowledge_items" USING btree ("workspace_id","kind");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_tts_voice_id_voices_id_fk" FOREIGN KEY ("tts_voice_id") REFERENCES "public"."voices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_portrait_asset_id_media_assets_id_fk" FOREIGN KEY ("portrait_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_current_render_id_video_renders_id_fk" FOREIGN KEY ("current_render_id") REFERENCES "public"."video_renders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_idx" ON "chat_messages" USING btree ("conversation_id","created_at");