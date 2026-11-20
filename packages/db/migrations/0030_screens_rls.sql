ALTER TABLE screens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY screens_tenant ON screens FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE screen_scenes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY screen_scenes_tenant ON screen_scenes FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
