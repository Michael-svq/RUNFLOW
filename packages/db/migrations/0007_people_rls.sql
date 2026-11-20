ALTER TABLE people ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY people_tenant ON people FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
