ALTER TYPE "public"."knowledge_kind" ADD VALUE 'angle';--> statement-breakpoint
ALTER TYPE "public"."knowledge_kind" ADD VALUE 'format';--> statement-breakpoint
ALTER TABLE "publish_events" DROP CONSTRAINT "publish_events_job_id_publish_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "ad_handoffs" DROP CONSTRAINT "ad_handoffs_job_id_publish_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "hook_experiments" DROP CONSTRAINT "hook_experiments_account_id_social_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "hook_variants" DROP CONSTRAINT "hook_variants_publish_job_id_publish_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "post_analytics_snapshots" ADD COLUMN "reach" bigint;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD COLUMN "mode" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD COLUMN "privacy" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing_connections" ADD COLUMN "mode" text DEFAULT 'mock' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "kind" "api_credential_kind" DEFAULT 'key' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "api_requests" ADD COLUMN "credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD COLUMN "max_credits" integer;--> statement-breakpoint
ALTER TABLE "publish_events" ADD CONSTRAINT "publish_events_job_id_publish_attempts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."publish_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_handoffs" ADD CONSTRAINT "ad_handoffs_job_id_publish_attempts_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."publish_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_experiments" ADD CONSTRAINT "hook_experiments_account_id_publishing_connections_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."publishing_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_variants" ADD CONSTRAINT "hook_variants_publish_job_id_publish_attempts_id_fk" FOREIGN KEY ("publish_job_id") REFERENCES "public"."publish_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_grant_idx" ON "api_keys" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "oauth_codes" DROP COLUMN "spend_cap_usd";