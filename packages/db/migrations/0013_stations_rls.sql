ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stations_tenant ON stations FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
