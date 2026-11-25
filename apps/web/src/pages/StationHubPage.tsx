import { useState } from 'react';
import { Button } from '@runflow/ui';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { RundownPicker, useRundownChoice } from '../direction/RundownPicker';
import { OutputsDialog } from '../outputs/OutputsDialog';
import { ScreensPanel } from '../production/ScreensPanel';
import { Devices } from './ConfigPage';
import { StationPanel } from './StationPage';

/* Dirección TV → RunFlow Station: servidor del estudio, equipos, pantallas y salidas. */

type Tab = 'station' | 'devices' | 'screens' | 'outputs';

export function StationHubPage() {
  const canStation = useCan('station.admin');
  const canDevices = useCan('devices.configure');
  const canOrg = useCan('org.configure');
  const canGo = useCan('live.go');
  const canPrompter = useCan('prompter.control');
  const tabs = (
    [
      ['station', 'Station', canStation],
      ['devices', 'Equipos', canDevices || canOrg],
      ['screens', 'Pantallas y escenas', true],
      ['outputs', 'Salidas', canGo || canPrompter],
    ] as [Tab, string, boolean][]
  ).filter(([, , ok]) => ok);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'screens');
  return (
    <>
      <PageHeader
        title="RunFlow Station"
        intro="El servidor del estudio, los equipos (CasparCG, mezcladores, luces…), las pantallas del plató y las salidas por enlace (prompter, relojes…)."
        actions={
          <div className="rf-tabs" role="tablist" aria-label="RunFlow Station">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`rf-tabs__tab${tab === k ? ' is-active' : ''}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'station' && <StationPanel />}
      {tab === 'devices' && <Devices />}
      {tab === 'screens' && <ScreensPanel />}
      {tab === 'outputs' && <OutputsPanel canManage={canGo || canPrompter} />}
    </>
  );
}

function OutputsPanel({ canManage }: { canManage: boolean }) {
  const choice = useRundownChoice();
  const [open, setOpen] = useState(false);
  return (
    <section className="rf-card" aria-label="Salidas">
      <p className="rf-muted rf-small">
        Enlaces para abrir en otros equipos sin cuenta: teleprompter, presentador, relojes, agenda,
        mensajes, multivista y mando (Companion / Stream Deck).
      </p>
      <div className="rf-config__inline">
        <RundownPicker
          rundowns={choice.rundowns}
          value={choice.rundown?.id ?? ''}
          onChange={choice.setId}
        />
        <Button disabled={!choice.rundown} onClick={() => setOpen(true)}>
          Gestionar salidas
        </Button>
      </div>
      {open && choice.rundown && (
        <OutputsDialog
          rundownId={choice.rundown.id}
          canManage={canManage}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
