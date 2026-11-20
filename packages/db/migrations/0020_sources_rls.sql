ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sources_tenant ON sources FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE source_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY source_items_tenant ON source_items FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
