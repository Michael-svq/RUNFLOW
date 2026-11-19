import { Navigate, Outlet, useLocation } from 'react-router';
import { errorMessage } from '../api/client';
import { useMe, useSetupStatus } from '../auth/session';
import { FullScreenError, FullScreenLoader } from './FullScreen';

/**
 * Decide adónde va el usuario según su sesión:
 * sin instalar → configuración inicial; sin sesión → entrar;
 * contraseña provisional → cambiarla; sin empresa → elegirla.
 */
export function RequireOrg() {
  const me = useMe();
  const setup = useSetupStatus(me.data === null);
  const location = useLocation();

  if (me.isPending || (me.data === null && setup.isPending)) return <FullScreenLoader />;
  if (me.isError)
    return <FullScreenError message={errorMessage(me.error)} onRetry={() => me.refetch()} />;
  if (me.data === null) {
    if (setup.data?.needsSetup) return <Navigate to="/configuracion-inicial" replace />;
    const next = location.pathname + location.search;
    return (
      <Navigate to={`/entrar${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    );
  }
  if (me.data.user.mustChangePassword) return <Navigate to="/cambiar-contrasena" replace />;
  if (!me.data.activeOrg) {
    // La administración de plataforma no necesita empresa activa.
    if (me.data.user.isPlatformAdmin && location.pathname.startsWith('/plataforma'))
      return <Outlet />;
    return <Navigate to="/elegir-empresa" replace />;
  }
  return <Outlet />;
}

/** Pantallas solo para quien no ha iniciado sesión (entrar, configuración inicial). */
export function RequireAnonymous() {
  const me = useMe();
  if (me.isPending) return <FullScreenLoader />;
  if (me.data) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Pantallas con sesión pero sin requisito de empresa (cambiar contraseña, elegir empresa). */
export function RequireSession() {
  const me = useMe();
  if (me.isPending) return <FullScreenLoader />;
  if (me.isError)
    return <FullScreenError message={errorMessage(me.error)} onRetry={() => me.refetch()} />;
  if (!me.data) return <Navigate to="/entrar" replace />;
  return <Outlet />;
}
