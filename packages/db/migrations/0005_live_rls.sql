ALTER TABLE asrun_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY asrun_log_tenant ON asrun_log FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
