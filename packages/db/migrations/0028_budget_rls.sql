ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_lines_tenant ON budget_lines FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
