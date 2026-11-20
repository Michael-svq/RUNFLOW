ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_tokens_tenant ON api_tokens FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhooks_tenant ON webhooks FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
