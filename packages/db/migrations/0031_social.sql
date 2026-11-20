CREATE TABLE "social_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"network" text NOT NULL,
	"query" text NOT NULL,
	"instance" text DEFAULT '' NOT NULL,
	"api_key_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"feed_id" uuid,
	"network" text NOT NULL,
	"external_id" text,
	"author" text NOT NULL,
	"handle" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"media_url" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone,
	"status" text DEFAULT 'nuevo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_feeds" ADD CONSTRAINT "social_feeds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_feed_id_social_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."social_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_feeds_org_idx" ON "social_feeds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "social_posts_org_status_idx" ON "social_posts" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_org_ext_idx" ON "social_posts" USING btree ("org_id","network","external_id");