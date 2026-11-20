ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY devices_tenant ON devices FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
