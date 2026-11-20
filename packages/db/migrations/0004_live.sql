CREATE TABLE "asrun_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"rundown_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"num" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_s" integer,
	"rehearsal" boolean DEFAULT false NOT NULL,
	"trigger" text NOT NULL,
	"user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "rundowns" ADD COLUMN "live" jsonb;--> statement-breakpoint
ALTER TABLE "asrun_log" ADD CONSTRAINT "asrun_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asrun_log" ADD CONSTRAINT "asrun_log_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asrun_log" ADD CONSTRAINT "asrun_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asrun_rundown_idx" ON "asrun_log" USING btree ("rundown_id","started_at");