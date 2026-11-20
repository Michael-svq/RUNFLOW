CREATE TABLE "crew_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"crew_id" uuid NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"call_at" timestamp with time zone,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"responded_at" timestamp with time zone,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_calls_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"arrival_at" timestamp with time zone,
	"makeup_at" timestamp with time zone,
	"set_at" timestamp with time zone,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"category" text DEFAULT 'otro' NOT NULL,
	"description" text NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone,
	"assignee" text DEFAULT '' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"program_id" uuid,
	"rundown_id" uuid,
	"title" text NOT NULL,
	"kind" text DEFAULT 'grabacion' NOT NULL,
	"status" text DEFAULT 'previsto' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_calls" ADD CONSTRAINT "event_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_calls" ADD CONSTRAINT "event_calls_event_id_production_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."production_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_calls" ADD CONSTRAINT "event_calls_crew_id_crew_members_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crew_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_event_id_production_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."production_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_items" ADD CONSTRAINT "logistics_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_items" ADD CONSTRAINT "logistics_items_event_id_production_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."production_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_events" ADD CONSTRAINT "production_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_events" ADD CONSTRAINT "production_events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_events" ADD CONSTRAINT "production_events_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_events" ADD CONSTRAINT "production_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_members_org_idx" ON "crew_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "event_calls_event_idx" ON "event_calls" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_calls_event_crew_idx" ON "event_calls" USING btree ("event_id","crew_id");--> statement-breakpoint
CREATE INDEX "guests_event_idx" ON "guests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "logistics_items_event_idx" ON "logistics_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "production_events_org_starts_idx" ON "production_events" USING btree ("org_id","starts_at");