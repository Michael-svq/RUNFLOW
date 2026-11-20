ALTER TABLE social_feeds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY social_feeds_tenant ON social_feeds FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY social_posts_tenant ON social_posts FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
