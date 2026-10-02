CREATE TYPE "public"."ad_handoff_kind" AS ENUM('tiktok_spark', 'meta_partnership');--> statement-breakpoint
CREATE TYPE "public"."ad_handoff_status" AS ENUM('awaiting_creator', 'ready', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('draft', 'running', 'decided', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."knowledge_tile_kind" AS ENUM('hook', 'angle', 'audience', 'format', 'insight');--> statement-breakpoint
CREATE TABLE "ad_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" "ad_handoff_kind" NOT NULL,
	"status" "ad_handoff_status" DEFAULT 'awaiting_creator' NOT NULL,
	"creator_handle" text DEFAULT '' NOT NULL,
	"code_enc" text,
	"code_hint" text,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"video_id" uuid,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hook_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"base_video_id" uuid NOT NULL,
	"status" "experiment_status" DEFAULT 'draft' NOT NULL,
	"metric" text DEFAULT 'views' NOT NULL,
	"min_views" integer DEFAULT 300 NOT NULL,
	"account_id" uuid,
	"winner_variant_id" uuid,
	"decision" jsonb,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"launched_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hook_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"pattern" text NOT NULL,
	"hook" text NOT NULL,
	"video_id" uuid NOT NULL,
	"publish_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_tiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "knowledge_tile_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"experiment_id" uuid,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_handoffs" ADD CONSTRAINT "ad_handoffs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_handoffs" ADD CONSTRAINT "ad_handoffs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_handoffs" ADD CONSTRAINT "ad_handoffs_job_id_publish_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."publish_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_briefs" ADD CONSTRAINT "creator_briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_briefs" ADD CONSTRAINT "creator_briefs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_experiments" ADD CONSTRAINT "hook_experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_experiments" ADD CONSTRAINT "hook_experiments_base_video_id_videos_id_fk" FOREIGN KEY ("base_video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_experiments" ADD CONSTRAINT "hook_experiments_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_variants" ADD CONSTRAINT "hook_variants_experiment_id_hook_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."hook_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_variants" ADD CONSTRAINT "hook_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_variants" ADD CONSTRAINT "hook_variants_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_variants" ADD CONSTRAINT "hook_variants_publish_job_id_publish_jobs_id_fk" FOREIGN KEY ("publish_job_id") REFERENCES "public"."publish_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tiles" ADD CONSTRAINT "knowledge_tiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tiles" ADD CONSTRAINT "knowledge_tiles_experiment_id_hook_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."hook_experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_handoffs_workspace_idx" ON "ad_handoffs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_briefs_workspace_idx" ON "creator_briefs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "hook_experiments_workspace_idx" ON "hook_experiments" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hook_variants_label_idx" ON "hook_variants" USING btree ("experiment_id","label");--> statement-breakpoint
CREATE INDEX "knowledge_tiles_workspace_idx" ON "knowledge_tiles" USING btree ("workspace_id","kind");