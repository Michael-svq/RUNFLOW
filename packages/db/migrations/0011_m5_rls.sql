ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_messages_tenant ON chat_messages FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE rundown_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rundown_templates_tenant ON rundown_templates FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE fridge_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fridge_items_tenant ON fridge_items FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE rundown_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rundown_versions_tenant ON rundown_versions FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
