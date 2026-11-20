ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_providers_tenant ON ai_providers FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_usage_tenant ON ai_usage FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
