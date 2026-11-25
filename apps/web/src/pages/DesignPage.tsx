import { useQuery } from '@tanstack/react-query';
import type { OrgSettings } from '@runflow/core';
import { Alert, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { DesignEditor, LiveSettings, settingsKey } from './ConfigPage';

/* Dirección TV → Diseño: ajustes de los rótulos y su diseño en RunFlow CG. */
export function DesignPage() {
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: async () => (await api.get<{ settings: OrgSettings }>('/api/org/settings')).settings,
  });
  return (
    <>
      <PageHeader
        title="Diseño"
        intro="Cómo se comportan y cómo se ven los rótulos: duración, salida automática, colores, tipografía, posición y animación. La vista previa es la misma plantilla que sale en antena."
      />
      {settings.isPending ? (
        <Spinner label="Cargando…" />
      ) : settings.isError ? (
        <Alert tone="error">{errorMessage(settings.error)}</Alert>
      ) : (
        <>
          <DesignEditor settings={settings.data} />
          <LiveSettings settings={settings.data} />
        </>
      )}
    </>
  );
}
