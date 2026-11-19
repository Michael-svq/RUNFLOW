import { Navigate, Route, Routes } from 'react-router';
import { RequireAnonymous, RequireOrg, RequireSession } from './components/Guards';
import { AppLayout } from './layouts/AppLayout';
import { NAV_ITEMS } from './layouts/nav';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ChooseOrgPage } from './pages/ChooseOrgPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { PlatformPage } from './pages/PlatformPage';
import { ProfilePage } from './pages/ProfilePage';
import { SetupPage } from './pages/SetupPage';
import { UsersPage } from './pages/UsersPage';
import { useCan, useMe } from './auth/session';

function RequireUsersPermission() {
  return useCan('users.manage') ? <UsersPage /> : <Navigate to="/inicio" replace />;
}

function RequirePlatformAdmin() {
  const { data } = useMe();
  return data?.user.isPlatformAdmin ? <PlatformPage /> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<RequireAnonymous />}>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/configuracion-inicial" element={<SetupPage />} />
      </Route>
      <Route element={<RequireSession />}>
        <Route path="/cambiar-contrasena" element={<ChangePasswordPage />} />
        <Route path="/elegir-empresa" element={<ChooseOrgPage />} />
      </Route>
      <Route element={<RequireOrg />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/inicio" replace />} />
          <Route path="/inicio" element={<HomePage />} />
          <Route path="/usuarios" element={<RequireUsersPermission />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/plataforma" element={<RequirePlatformAdmin />} />
          {NAV_ITEMS.filter((i) => i.milestone).map((item) => (
            <Route key={item.path} path={item.path} element={<PlaceholderPage item={item} />} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
