import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { MeResponse } from '@runflow/core';
import { Alert, Logo } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe, useLogout, useMe } from '../auth/session';
import { t } from '../i18n';
import { useTheme } from '../lib/theme';
import { areaForPath, areaItems } from './areas';
import { useArea } from './useArea';
import { Dropdown, MenuLink, StageMessageButton } from './HeaderMenus';
import { useStationStatus } from '../pages/StationPage';
import { VerifyEmailBanner } from '../pages/AccountPages';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function OrgSwitcher({ me }: { me: MeResponse }) {
  const applyMe = useApplyMe();
  const navigate = useNavigate();
  if (me.organizations.length < 2) {
    return <span className="rf-header__org">{me.activeOrg?.name}</span>;
  }
  return (
    <select
      className="rf-select rf-header__org-select"
      aria-label={t('nav.switchOrg')}
      value={me.activeOrg?.id ?? ''}
      onChange={async (e) => {
        const next = await api.post<MeResponse>('/api/auth/active-org', { orgId: e.target.value });
        applyMe(next);
        navigate('/inicio');
      }}
    >
      {!me.activeOrg && <option value="">{t('chooseOrg.title')}</option>}
      {me.organizations.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** En una Station: avisa si no hay conexión con la nube o si la licencia no está en vigor. */
function StationBanner() {
  const status = useStationStatus();
  const s = status.data;
  if (!s) return null;
  if (s.license && !s.license.writable) {
    return (
      <div className="rf-station-banner">
        <Alert tone="error">{s.license.message}</Alert>
      </div>
    );
  }
  if (s.sync && !s.sync.online && s.sync.lastSyncAt) {
    return (
      <div className="rf-station-banner">
        <Alert tone="warning">
          Sin conexión con la nube: se sigue trabajando en la Station y todo se sincronizará al
          volver internet.
        </Alert>
      </div>
    );
  }
  if (s.license && (s.license.state === 'grace' || s.license.state === 'trial')) {
    return (
      <div className="rf-station-banner">
        <Alert tone="warning">{s.license.message}</Alert>
      </div>
    );
  }
  return null;
}

export function AppLayout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const permissions = me?.activeOrg?.permissions ?? [];
  const area = useArea();

  useEffect(() => setMenuOpen(false), [location.pathname]);
  // Al abrir una página que solo es de otra área, se cambia a esa área.
  useEffect(() => {
    const owner = areaForPath(location.pathname, area.allowed);
    if (owner && owner !== area.current?.key) area.set(owner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  if (!me) return null;

  const items = area.current ? areaItems(area.current, permissions) : [];
  const isAdmin =
    permissions.includes('org.configure') ||
    permissions.includes('users.manage') ||
    me.user.isPlatformAdmin;
  const canStage = permissions.includes('prompter.control') || permissions.includes('live.go');
  const dark = theme === 'interior';

  return (
    <div className={`rf-shell${menuOpen ? ' rf-shell--menu-open' : ''}`}>
      <aside className="rf-sidebar" aria-label={t('nav.menu')}>
        <div className="rf-sidebar__brand">
          <Logo size={20} />
        </div>
        {area.allowed.length > 1 && (
          <div className="rf-sidebar__areas" role="group" aria-label="Área de trabajo (móvil)">
            {area.allowed.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`rf-areas__tab${a.key === area.current?.key ? ' is-active' : ''}`}
                onClick={() => {
                  area.set(a.key);
                  navigate('/inicio');
                }}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        )}
        {area.current && (
          <div className="rf-sidebar__area" aria-hidden="true">
            {area.current.icon} {area.current.label}
          </div>
        )}
        <nav className="rf-nav">
          {me.activeOrg &&
            items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/inicio'}
                title={item.label}
                className="rf-nav__item"
              >
                <span className="rf-nav__number" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="rf-nav__label">{item.label}</span>
              </NavLink>
            ))}
        </nav>
        <div className="rf-sidebar__footer">
          <button
            type="button"
            className={`rf-theme-toggle${dark ? '' : ' is-light'}`}
            onClick={() => setTheme(dark ? 'exterior' : 'interior')}
            aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={dark ? 'Modo oscuro (pulsa para el claro)' : 'Modo claro (pulsa para el oscuro)'}
          >
            <span aria-hidden="true">{dark ? '☾' : '☀'}</span>
            <span className="rf-theme-toggle__label">{dark ? 'Modo oscuro' : 'Modo claro'}</span>
          </button>
        </div>
      </aside>

      <div className="rf-main">
        <header className="rf-header">
          <button
            type="button"
            className="rf-btn rf-btn--ghost rf-btn--sm rf-header__menu"
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
          <span className="rf-header__mobile-logo">
            <Logo size={16} />
          </span>
          <OrgSwitcher me={me} />
          {area.allowed.length > 1 && (
            <div className="rf-areas" role="tablist" aria-label="Área de trabajo">
              {area.allowed.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="tab"
                  aria-selected={a.key === area.current?.key}
                  className={`rf-areas__tab${a.key === area.current?.key ? ' is-active' : ''}`}
                  onClick={() => {
                    area.set(a.key);
                    navigate('/inicio');
                  }}
                >
                  <span aria-hidden="true">{a.icon}</span> {a.label}
                </button>
              ))}
            </div>
          )}
          <div className="rf-header__spacer" />
          {area.current?.key === 'direccion' && canStage && <StageMessageButton />}
          {isAdmin && (
            <Dropdown
              label="Administración"
              className="rf-header__admin"
              button={<span aria-hidden="true">⚙</span>}
            >
              {permissions.includes('org.configure') && (
                <MenuLink to="/configuracion">Configuración</MenuLink>
              )}
              {permissions.includes('users.manage') && (
                <MenuLink to="/usuarios">{t('nav.users')}</MenuLink>
              )}
              {me.user.isPlatformAdmin && <MenuLink to="/plataforma">{t('nav.platform')}</MenuLink>}
            </Dropdown>
          )}
          <Dropdown
            label="Mi cuenta"
            className="rf-header__account"
            button={
              <span className="rf-header__user">
                <span className="rf-avatar" aria-hidden="true">
                  {initials(me.user.name)}
                </span>
                <span className="rf-header__user-text">
                  <span className="rf-header__user-name">{me.user.name}</span>
                  {me.activeOrg && (
                    <span className="rf-header__user-role">{me.activeOrg.role.name}</span>
                  )}
                </span>
              </span>
            }
          >
            <MenuLink to="/perfil">{t('nav.profile')}</MenuLink>
            <MenuLink to="/ayuda">Ayuda</MenuLink>
            <button
              type="button"
              role="menuitem"
              className="rf-dropdown__item"
              onClick={async () => {
                await logout();
                navigate('/entrar', { replace: true });
              }}
            >
              {t('nav.logout')}
            </button>
          </Dropdown>
        </header>
        <main className="rf-content" id="contenido">
          {me.mode === 'station' && <StationBanner />}
          {!me.user.emailVerified && <VerifyEmailBanner email={me.user.email} />}
          <Outlet />
        </main>
      </div>
      <div className="rf-shell__scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
    </div>
  );
}
