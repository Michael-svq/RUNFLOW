ALTER TABLE production_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_events_tenant ON production_events FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE crew_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY crew_members_tenant ON crew_members FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE event_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY event_calls_tenant ON event_calls FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY guests_tenant ON guests FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE logistics_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY logistics_items_tenant ON logistics_items FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
-- Nuevos permisos de Fase III en los roles ya creados de cada empresa.
UPDATE roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['production.view','production.manage','budget.view','budget.manage']))
  WHERE key IN ('admin', 'productor');
--> statement-breakpoint
UPDATE roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['production.view','production.manage']))
  WHERE key IN ('produccion', 'profesor');
--> statement-breakpoint
UPDATE roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['production.view']))
  WHERE key = 'realizador';
