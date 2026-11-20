CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"program_id" uuid,
	"event_id" uuid,
	"category" text DEFAULT 'otros' NOT NULL,
	"concept" text NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"planned_cents" bigint DEFAULT 0 NOT NULL,
	"actual_cents" bigint,
	"date" date,
	"invoice" text DEFAULT '' NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_event_id_production_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."production_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_lines_org_date_idx" ON "budget_lines" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "budget_lines_event_idx" ON "budget_lines" USING btree ("event_id");