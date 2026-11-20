import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { MeResponse } from '@runflow/core';
import { Alert, Badge, Button, Logo } from '@runflow/ui';
import { api } from '../api/client';
import { useApplyMe, useLogout, useMe } from '../auth/session';
import { t } from '../i18n';
import { useTheme } from '../lib/theme';
import { NAV_ITEMS } from './nav';
import { useStationStatus } from '../pages/StationPage';

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

  useEffect(() => setMenuOpen(false), [location.pathname]);
  if (!me) return null;

  const permissions = me.activeOrg?.permissions ?? [];
  const items = NAV_ITEMS.filter((i) => !i.permission || permissions.includes(i.permission));

  return (
    <div className={`rf-shell${menuOpen ? ' rf-shell--menu-open' : ''}`}>
      <aside className="rf-sidebar" aria-label={t('nav.menu')}>
        <div className="rf-sidebar__brand">
          <Logo size={20} />
        </div>
        <nav className="rf-nav">
          {me.activeOrg && (
            <NavLink to="/inicio" className="rf-nav__item">
              <span className="rf-nav__number" aria-hidden="true">
                ⌂
              </span>
              <span className="rf-nav__label">{t('nav.home')}</span>
            </NavLink>
          )}
          {me.activeOrg &&
            items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={t(item.label)}
                className={`rf-nav__item${item.milestone ? ' rf-nav__item--soon' : ''}`}
              >
                <span className="rf-nav__number">{item.number}</span>
                <span className="rf-nav__label">{t(item.label)}</span>
                {item.milestone && (
                  <Badge tone="muted" title={t('nav.comingSoon')}>
                    {item.milestone}
                  </Badge>
                )}
              </NavLink>
            ))}
          {me.user.isPlatformAdmin && (
            <NavLink to="/plataforma" className="rf-nav__item rf-nav__item--platform">
              <span className="rf-nav__number" aria-hidden="true">
                ◆
              </span>
              <span className="rf-nav__label">{t('nav.platform')}</span>
            </NavLink>
          )}
        </nav>
        <div className="rf-sidebar__footer">
          <div className="rf-theme-switch" role="group" aria-label={t('theme.label')}>
            {(['interior', 'exterior'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`rf-theme-switch__btn${theme === value ? ' is-active' : ''}`}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {t(`theme.${value}`)}
              </button>
            ))}
          </div>
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
          <div className="rf-header__spacer" />
          <div className="rf-header__user">
            <span className="rf-avatar" aria-hidden="true">
              {initials(me.user.name)}
            </span>
            <span className="rf-header__user-text">
              <span className="rf-header__user-name">{me.user.name}</span>
              {me.activeOrg && (
                <span className="rf-header__user-role">{me.activeOrg.role.name}</span>
              )}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              navigate('/entrar', { replace: true });
            }}
          >
            {t('nav.logout')}
          </Button>
        </header>
        <main className="rf-content" id="contenido">
          {me.mode === 'station' && <StationBanner />}
          <Outlet />
        </main>
      </div>
      <div className="rf-shell__scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
    </div>
  );
}
