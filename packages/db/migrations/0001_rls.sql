-- Aislamiento por empresa con Row Level Security (docs/adr/0002-aislamiento-rls.md).
-- La aplicación se conecta con un rol que NO es propietario de las tablas, así que
-- estas políticas se aplican siempre. El contexto se fija por transacción con
-- set_config('app.org_id' | 'app.user_id' | 'app.bypass_rls', ..., true).

CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;
--> statement-breakpoint

-- Funciones con privilegios del propietario (saltan RLS) para preguntas puntuales
-- que una empresa necesita hacer sobre cuentas globales, sin exponer sus datos.
CREATE OR REPLACE FUNCTION rf_user_id_by_email(p_email text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM users WHERE lower(email) = lower(p_email) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION rf_user_membership_count(p_user_id uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM memberships WHERE user_id = p_user_id $$;
--> statement-breakpoint
-- Borra una cuenta solo si ya no pertenece a ninguna empresa y no es administradora de plataforma.
CREATE OR REPLACE FUNCTION rf_delete_orphan_user(p_user_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM users u
   WHERE u.id = p_user_id
     AND NOT u.is_platform_admin
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted > 0;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rf_user_id_by_email(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rf_user_membership_count(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rf_delete_orphan_user(uuid) FROM PUBLIC;
--> statement-breakpoint

-- organizations ---------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_select ON organizations FOR SELECT USING (
  app_bypass_rls()
  OR id = app_org_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id AND m.user_id = app_user_id())
);
--> statement-breakpoint
CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (app_bypass_rls());
--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (app_bypass_rls() OR id = app_org_id())
  WITH CHECK (app_bypass_rls() OR id = app_org_id());
--> statement-breakpoint
CREATE POLICY organizations_delete ON organizations FOR DELETE USING (app_bypass_rls());
--> statement-breakpoint

-- users (cuentas globales) ----------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT USING (
  app_bypass_rls()
  OR id = app_user_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = app_org_id())
);
--> statement-breakpoint
-- Una empresa puede crear cuentas nuevas (luego les añade su membresía).
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (
  app_bypass_rls() OR app_org_id() IS NOT NULL
);
--> statement-breakpoint
-- Cada usuario edita su cuenta; una empresa solo edita cuentas que pertenecen únicamente a ella.
CREATE POLICY users_update ON users FOR UPDATE
  USING (
    app_bypass_rls()
    OR id = app_user_id()
    OR (
      EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = app_org_id())
      AND rf_user_membership_count(users.id) = 1
    )
  )
  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY users_delete ON users FOR DELETE USING (app_bypass_rls());
--> statement-breakpoint

-- sessions --------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_all ON sessions FOR ALL
  USING (app_bypass_rls() OR user_id = app_user_id())
  WITH CHECK (app_bypass_rls() OR user_id = app_user_id());
--> statement-breakpoint

-- roles -----------------------------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_select ON roles FOR SELECT USING (
  app_bypass_rls()
  OR org_id = app_org_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.role_id = roles.id AND m.user_id = app_user_id())
);
--> statement-breakpoint
CREATE POLICY roles_write ON roles FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint

-- memberships -----------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  app_bypass_rls() OR org_id = app_org_id() OR user_id = app_user_id()
);
--> statement-breakpoint
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
--> statement-breakpoint

-- audit_log (solo añadir) -----------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (
  app_bypass_rls() OR org_id = app_org_id()
);
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (
  app_bypass_rls() OR org_id = app_org_id()
);
