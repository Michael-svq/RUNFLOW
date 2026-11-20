ALTER TABLE media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY media_tenant ON media FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
