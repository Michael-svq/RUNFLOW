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
import { RundownPage } from './pages/RundownPage';
import { OutputPage } from './pages/OutputPage';
import { PrompterPage } from './pages/PrompterPage';
import { FridgePage } from './pages/FridgePage';
import { ArchivePage } from './pages/ArchivePage';
import { PrintPage } from './pages/PrintPage';
import { RundownsPage } from './pages/RundownsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SetupPage } from './pages/SetupPage';
import { UsersPage } from './pages/UsersPage';
import { StationPage } from './pages/StationPage';
import { ConfigPage } from './pages/ConfigPage';
import { SignupPage } from './pages/SignupPage';
import { SourcesPage } from './pages/SourcesPage';
import { MediaPage } from './pages/MediaPage';
import { HelpPage } from './pages/HelpPage';
import { ProductionPage } from './pages/ProductionPage';
import { CallReplyPage, CallSheetPage } from './pages/CallSheetPage';
import { useCan, useMe } from './auth/session';

function RequireUsersPermission() {
  return useCan('users.manage') ? <UsersPage /> : <Navigate to="/inicio" replace />;
}

function RequireStationPermission() {
  return useCan('station.admin') ? <StationPage /> : <Navigate to="/inicio" replace />;
}

function RequireConfigPermission() {
  return useCan('org.configure') ? <ConfigPage /> : <Navigate to="/inicio" replace />;
}

function RequireProductionPermission() {
  return useCan('production.view') ? <ProductionPage /> : <Navigate to="/inicio" replace />;
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
        <Route path="/registro" element={<SignupPage />} />
      </Route>
      <Route element={<RequireSession />}>
        <Route path="/cambiar-contrasena" element={<ChangePasswordPage />} />
        <Route path="/elegir-empresa" element={<ChooseOrgPage />} />
      </Route>
      {/* Salidas por enlace: sin usuario. */}
      <Route path="/salida/:token" element={<OutputPage />} />
      <Route path="/ayuda" element={<HelpPage />} />
      <Route path="/convocatoria/:token" element={<CallReplyPage />} />
      <Route element={<RequireOrg />}>
        <Route path="/escaletas/:id/prompter" element={<PrompterPage />} />
        <Route path="/escaletas/:id/imprimir" element={<PrintPage />} />
        <Route path="/produccion/:id/hoja" element={<CallSheetPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/inicio" replace />} />
          <Route path="/inicio" element={<HomePage />} />
          <Route path="/usuarios" element={<RequireUsersPermission />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/escaletas" element={<RundownsPage />} />
          <Route path="/nevera" element={<FridgePage />} />
          <Route path="/fuentes" element={<SourcesPage />} />
          <Route path="/media" element={<MediaPage />} />
          <Route path="/archivo" element={<ArchivePage />} />
          <Route path="/station" element={<RequireStationPermission />} />
          <Route path="/configuracion" element={<RequireConfigPermission />} />
          <Route path="/produccion" element={<RequireProductionPermission />} />
          <Route path="/escaletas/:id" element={<RundownPage />} />
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
