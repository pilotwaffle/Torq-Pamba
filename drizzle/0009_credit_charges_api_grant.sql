ALTER TABLE "credit_charges" ADD COLUMN "api_grant_id" uuid;--> statement-breakpoint
CREATE INDEX "credit_charges_api_grant_idx" ON "credit_charges" USING btree ("api_grant_id","created_at");