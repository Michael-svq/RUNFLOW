ALTER TABLE outputs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY outputs_tenant ON outputs FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
