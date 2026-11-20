CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"folder" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"duration_s" double precision,
	"width" integer,
	"height" integer,
	"proxy_status" text DEFAULT 'none' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_org_folder_idx" ON "media" USING btree ("org_id","folder");