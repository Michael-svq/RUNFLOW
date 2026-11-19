-- Aislamiento por empresa de programas, escaletas, líneas y vistas (ver 0001_rls.sql).
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY programs_tenant ON programs FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE rundowns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rundowns_tenant ON rundowns FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE rundown_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rundown_lines_tenant ON rundown_lines FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint
ALTER TABLE views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Vistas: las compartidas las ve toda la empresa; las personales, solo su dueño.
CREATE POLICY views_select ON views FOR SELECT USING (
  app_bypass_rls()
  OR (org_id = app_org_id() AND (owner_user_id IS NULL OR owner_user_id = app_user_id()))
);
--> statement-breakpoint
CREATE POLICY views_write ON views FOR ALL
  USING (app_bypass_rls() OR (org_id = app_org_id() AND (owner_user_id IS NULL OR owner_user_id = app_user_id())))
  WITH CHECK (app_bypass_rls() OR (org_id = app_org_id() AND (owner_user_id IS NULL OR owner_user_id = app_user_id())));
