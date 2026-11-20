import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEVICE_KIND_LABEL,
  DEVICE_KINDS,
  GRAPHIC_TYPES,
  VMIX_TRANSITIONS,
  type CgDesign,
  type DeviceDto,
  type DeviceKind,
  type OrgSettings,
} from '@runflow/core';
import { Alert, Badge, Button, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { AiConfig } from './AiConfig';
import { BillingConfig } from './BillingConfig';

/*
 * 10 Configuración (nivel Master de la empresa): rótulos y directo, diseño de
 * las plantillas de RunFlow CG con vista previa real y equipos (CasparCG).
 */

const settingsKey = ['org-settings'];
const devicesKey = ['devices'];

const SAMPLE: Record<string, Record<string, string>> = {
  TOT: { f0: 'María Jesús Montero', f1: 'Ministra de Hacienda' },
  LOC: { f0: 'Sevilla, Andalucía' },
  INF: { f0: 'Lucía Romero', f1: 'Cámara: Pablo Gil · Edición: Ana Ruiz' },
  DAT: { f0: '20 de noviembre de 2026' },
  BAN: { f0: 'El Gobierno aprueba los presupuestos', f1: 'Más inversión en educación y sanidad' },
  HIG: { f0: '3.000 millones', f1: 'para vivienda pública' },
};

export function ConfigPage() {
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: async () => (await api.get<{ settings: OrgSettings }>('/api/org/settings')).settings,
  });
  return (
    <>
      <PageHeader
        number="10"
        title="Configuración"
        intro="Opciones Master de la empresa: rótulos, directo, diseño de la grafía, equipos del estudio e inteligencia artificial."
      />
      {settings.isPending ? (
        <Spinner label="Cargando…" />
      ) : settings.isError ? (
        <Alert tone="error">{errorMessage(settings.error)}</Alert>
      ) : (
        <>
          <BillingConfig />
          <LiveSettings settings={settings.data} />
          <DesignEditor settings={settings.data} />
          <Devices />
          <AiConfig settings={settings.data} />
        </>
      )}
    </>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  const [state, setState] = useState<{
    busy: boolean;
    notice: { ok: boolean; text: string } | null;
  }>({ busy: false, notice: null });
  const save = async (patch: unknown) => {
    setState({ busy: true, notice: null });
    try {
      const res = await api.patch<{ settings: OrgSettings }>('/api/org/settings', patch);
      qc.setQueryData(settingsKey, res.settings);
      setState({ busy: false, notice: { ok: true, text: 'Guardado.' } });
    } catch (err) {
      setState({ busy: false, notice: { ok: false, text: errorMessage(err) } });
    }
  };
  return { ...state, save };
}

/* ---------- Rótulos y directo ---------- */

function LiveSettings({ settings }: { settings: OrgSettings }) {
  const [form, setForm] = useState({
    graphicSeconds: String(settings.graphicSeconds),
    cameraAutoOut: settings.cameraAutoOut,
    prerollNext: settings.prerollNext,
  });
  const { busy, notice, save } = useSaveSettings();
  return (
    <section className="rf-card rf-config">
      <h2 className="rf-form__title">Rótulos y directo</h2>
      <form
        className="rf-config__form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            graphicSeconds: Number(form.graphicSeconds),
            cameraAutoOut: form.cameraAutoOut,
            prerollNext: form.prerollNext,
          });
        }}
      >
        <TextField
          label="Duración de un rótulo sin TC de salida (segundos)"
          type="number"
          min={1}
          max={120}
          value={form.graphicSeconds}
          onChange={(e) => setForm({ ...form, graphicSeconds: e.target.value })}
          hint="Se usa en los VTR con solo TC de entrada y en los rótulos de cámara con salida automática."
        />
        <label className="rf-check">
          <input
            type="checkbox"
            checked={form.cameraAutoOut}
            onChange={(e) => setForm({ ...form, cameraAutoOut: e.target.checked })}
          />
          <span>
            Rótulos de cámara/directo: <strong>salida automática</strong> tras esa duración (si no,
            salen con ■)
          </span>
        </label>
        <label className="rf-check">
          <input
            type="checkbox"
            checked={form.prerollNext}
            onChange={(e) => setForm({ ...form, prerollNext: e.target.checked })}
          />
          <span>Precargar en CasparCG el VTR de la línea SIGUIENTE (arranque instantáneo)</span>
        </label>
        <div className="rf-form__actions">
          <Button type="submit" variant="primary" loading={busy}>
            Guardar
          </Button>
          {notice && <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>}
        </div>
      </form>
    </section>
  );
}

/* ---------- Diseño de rótulos ---------- */

function DesignEditor({ settings }: { settings: OrgSettings }) {
  const [design, setDesign] = useState<CgDesign>(settings.cgDesign);
  const [type, setType] = useState('TOT');
  const frame = useRef<HTMLIFrameElement>(null);
  const { busy, notice, save } = useSaveSettings();
  const set = <K extends keyof CgDesign>(key: K, value: CgDesign[K]) =>
    setDesign((d) => ({ ...d, [key]: value }));

  const post = (cmd: 'update' | 'play' | 'stop', data?: unknown) =>
    frame.current?.contentWindow?.postMessage({ runflowCg: true, cmd, data }, '*');
  const sample = () => {
    const fields = SAMPLE[type] ?? {};
    return {
      type,
      design,
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, design.uppercase ? v.toUpperCase() : v]),
      ),
    };
  };
  useEffect(() => {
    post('update', sample());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, type]);

  return (
    <section className="rf-card rf-config">
      <h2 className="rf-form__title">Diseño de los rótulos</h2>
      <p className="rf-muted rf-small">
        Es la misma plantilla HTML que ejecuta CasparCG: lo que ves aquí es lo que sale.
      </p>
      <div className="rf-config__design">
        <div className="rf-config__preview">
          <div className="rf-config__types" role="tablist" aria-label="Tipo de rótulo">
            {GRAPHIC_TYPES.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={type === g.key}
                className={`rf-panel-tabs__tab${type === g.key ? ' is-active' : ''}`}
                onClick={() => setType(g.key)}
                title={g.name}
              >
                {g.key}
              </button>
            ))}
          </div>
          <div className="rf-config__screen">
            <iframe
              ref={frame}
              key={type}
              title={`Vista previa del rótulo ${type}`}
              src={`/cg/templates/${type}.html?preview=1`}
              onLoad={() => {
                post('update', sample());
                post('play');
              }}
            />
          </div>
          <div className="rf-form__actions">
            <Button size="sm" onClick={() => post('play')}>
              ▶ Entrar
            </Button>
            <Button size="sm" onClick={() => post('stop')}>
              ■ Salir
            </Button>
          </div>
        </div>
        <form
          className="rf-config__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ cgDesign: design });
          }}
        >
          <div className="rf-config__colors">
            {(
              [
                ['primary', 'Color principal'],
                ['secondary', 'Fondo'],
                ['text', 'Texto'],
                ['accentText', 'Texto sobre el principal'],
              ] as [keyof CgDesign, string][]
            ).map(([key, label]) => (
              <label key={key} className="rf-config__color">
                <input
                  type="color"
                  value={String(design[key])}
                  onChange={(e) => set(key, e.target.value as never)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <SelectField
            label="Tipografía"
            value={design.font}
            onChange={(e) => set('font', e.target.value as CgDesign['font'])}
            options={['Montserrat', 'Helvetica', 'Arial', 'Roboto', 'Georgia'].map((f) => ({
              value: f,
              label: f,
            }))}
          />
          <SelectField
            label="Alineación de los inferiores"
            value={design.align}
            onChange={(e) => set('align', e.target.value as CgDesign['align'])}
            options={[
              { value: 'left', label: 'Izquierda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Derecha' },
            ]}
          />
          <label className="rf-field">
            <span className="rf-field__label">
              Altura sobre el borde inferior: {design.bottom}%
            </span>
            <input
              type="range"
              min={0}
              max={40}
              value={design.bottom}
              onChange={(e) => set('bottom', Number(e.target.value))}
            />
          </label>
          <label className="rf-field">
            <span className="rf-field__label">Margen de seguridad lateral: {design.margin}%</span>
            <input
              type="range"
              min={0}
              max={20}
              value={design.margin}
              onChange={(e) => set('margin', Number(e.target.value))}
            />
          </label>
          <SelectField
            label="Animación"
            value={design.animation}
            onChange={(e) => set('animation', e.target.value as CgDesign['animation'])}
            options={[
              { value: 'slide', label: 'Deslizar' },
              { value: 'fade', label: 'Fundido' },
              { value: 'wipe', label: 'Cortinilla' },
            ]}
          />
          <TextField
            label="Duración de la animación (ms)"
            type="number"
            min={0}
            max={2000}
            value={String(design.animationMs)}
            onChange={(e) => set('animationMs', Number(e.target.value) || 0)}
          />
          <TextField
            label="Mosca (texto junto a la fecha)"
            maxLength={24}
            value={design.bug}
            onChange={(e) => set('bug', e.target.value)}
          />
          <label className="rf-check">
            <input
              type="checkbox"
              checked={design.uppercase}
              onChange={(e) => set('uppercase', e.target.checked)}
            />
            <span>Textos en mayúsculas</span>
          </label>
          <div className="rf-form__actions">
            <Button type="submit" variant="primary" loading={busy}>
              Guardar diseño
            </Button>
            {notice && <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>}
          </div>
        </form>
      </div>
    </section>
  );
}

/* ---------- Equipos ---------- */

type Kind = DeviceKind;

interface DeviceForm {
  id: string | null;
  kind: Kind;
  name: string;
  enabled: boolean;
  /** Campos de texto de la configuración (se convierten al guardar). */
  f: Record<string, string>;
  /** Opciones sí/no (modo estudio de OBS…). */
  b: Record<string, boolean>;
  /** Mapa de fuentes: FUENTE → entrada del mezclador. */
  sources: [string, string][];
}

const DEFAULT_SOURCES: [string, string][] = [
  ['CAM 1', ''],
  ['CAM 2', ''],
  ['CAM 3', ''],
  ['VTR', ''],
];

const DEFAULTS: Record<Kind, Pick<DeviceForm, 'name' | 'f' | 'b'>> = {
  casparcg: {
    name: 'CasparCG',
    f: {
      host: '127.0.0.1',
      port: '5250',
      oscPort: '6250',
      channel: '1',
      vtr: '10',
      lower: '20',
      banner: '30',
      logo: '40',
      templateBaseUrl: '',
    },
    b: {},
  },
  obs: {
    name: 'OBS',
    f: { host: '127.0.0.1', port: '4455', password: '' },
    b: { studioMode: false },
  },
  vmix: {
    name: 'vMix',
    f: { host: '127.0.0.1', port: '8099', transition: 'CutDirect', durationMs: '500' },
    b: {},
  },
  atem: { name: 'ATEM', f: { host: '192.168.10.240', me: '1', transition: 'cut' }, b: {} },
};

const emptyDevice = (kind: Kind): DeviceForm => ({
  id: null,
  kind,
  enabled: true,
  ...DEFAULTS[kind],
  f: { ...DEFAULTS[kind].f },
  b: { ...DEFAULTS[kind].b },
  sources: kind === 'casparcg' ? [] : DEFAULT_SOURCES.map(([k, v]) => [k, v]),
});

function toForm(d: DeviceDto): DeviceForm {
  const base = emptyDevice(d.kind);
  const f: Record<string, string> = {};
  const b: Record<string, boolean> = {};
  let sources: [string, string][] = [];
  for (const [k, v] of Object.entries(d.config)) {
    if (k === 'sources') sources = Object.entries(v as Record<string, string>);
    else if (k === 'layers')
      for (const [lk, lv] of Object.entries(v as Record<string, number>)) f[lk] = String(lv);
    else if (typeof v === 'boolean') b[k] = v;
    else f[k] = String(k === 'me' ? Number(v) + 1 : v);
  }
  return { ...base, id: d.id, name: d.name, enabled: d.enabled, f, b, sources };
}

function toConfig(form: DeviceForm): Record<string, unknown> {
  const { f, b } = form;
  const n = (k: string) => Number(f[k]);
  const sources = Object.fromEntries(
    form.sources.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()]),
  );
  switch (form.kind) {
    case 'casparcg':
      return {
        host: f.host!.trim(),
        port: n('port'),
        oscPort: n('oscPort'),
        channel: n('channel'),
        layers: { vtr: n('vtr'), lower: n('lower'), banner: n('banner'), logo: n('logo') },
        templateBaseUrl: (f.templateBaseUrl ?? '').trim(),
      };
    case 'obs':
      return {
        host: f.host!.trim(),
        port: n('port'),
        password: f.password ?? '',
        studioMode: !!b.studioMode,
        sources,
      };
    case 'vmix':
      return {
        host: f.host!.trim(),
        port: n('port'),
        transition: f.transition,
        durationMs: n('durationMs'),
        sources,
      };
    case 'atem':
      return {
        host: f.host!.trim(),
        me: Math.max(0, n('me') - 1),
        transition: f.transition,
        sources,
      };
  }
}

const INPUT_HINT: Record<Kind, string> = {
  casparcg: '',
  obs: 'Nombre de la escena de OBS',
  vmix: 'Número o nombre de la entrada de vMix',
  atem: 'Número de entrada del ATEM (1 = Cámara 1, 3010 = Media Player 1…)',
};

function deviceSummary(d: DeviceDto): string {
  const c = d.config as { host: string; port?: number; channel?: number };
  const where = c.port ? `${c.host}:${c.port}` : c.host;
  return d.kind === 'casparcg' ? `${where} · canal ${c.channel}` : where;
}

function Devices() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: devicesKey,
    queryFn: async () => (await api.get<{ devices: DeviceDto[] }>('/api/devices')).devices,
    refetchInterval: 5000,
  });
  const [form, setForm] = useState<DeviceForm | null>(null);
  const [addKind, setAddKind] = useState<Kind>('casparcg');
  const [busy, setBusy] = useState(false);
  const [inputs, setInputs] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<string | null>(null);

  const open = (next: DeviceForm | null) => {
    setForm(next);
    setInputs(null);
    setNotice(null);
  };

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        name: form.name,
        kind: form.kind,
        enabled: form.enabled,
        config: toConfig(form),
      };
      if (form.id) await api.patch(`/api/devices/${form.id}`, body);
      else await api.post('/api/devices', body);
      open(null);
      void qc.invalidateQueries({ queryKey: devicesKey });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!form) return;
    setNotice({ tone: 'info', text: 'Probando conexión…' });
    try {
      const res = await api.post<{
        ok: boolean;
        version?: string;
        clips?: number;
        inputs?: number;
        error?: string;
      }>('/api/devices/test', { kind: form.kind, config: toConfig(form) });
      setNotice(
        res.ok
          ? {
              tone: 'success',
              text: `Conectado: ${res.version}${
                res.clips !== undefined ? ` · ${res.clips} clips` : ''
              }${res.inputs !== undefined ? ` · ${res.inputs} entradas` : ''}`,
            }
          : { tone: 'error', text: `Sin conexión: ${res.error}` },
      );
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function loadInputs() {
    if (!form?.id) return;
    try {
      setInputs((await api.get<{ inputs: string[] }>(`/api/devices/${form.id}/inputs`)).inputs);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  const field = (key: string, label: string, extra: Record<string, unknown> = {}) => (
    <TextField
      key={key}
      label={label}
      value={form!.f[key] ?? ''}
      onChange={(e) => setForm({ ...form!, f: { ...form!.f, [key]: e.target.value } })}
      {...extra}
    />
  );
  const select = (key: string, label: string, options: { value: string; label: string }[]) => (
    <SelectField
      key={key}
      label={label}
      value={form!.f[key] ?? ''}
      options={options}
      onChange={(e) => setForm({ ...form!, f: { ...form!.f, [key]: e.target.value } })}
    />
  );
  const num = { type: 'number', min: 0 };

  return (
    <section className="rf-card rf-config">
      <div className="rf-config__head">
        <h2 className="rf-form__title">Equipos del estudio</h2>
        {!form && (
          <span className="rf-config__add">
            <select
              className="rf-select"
              aria-label="Tipo de equipo"
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as Kind)}
            >
              {DEVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DEVICE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => open(emptyDevice(addKind))}>
              Añadir equipo
            </Button>
          </span>
        )}
      </div>
      <p className="rf-muted rf-small">
        CasparCG para rótulos y VTR; OBS, vMix o ATEM como mezclador. Con GO, el mezclador corta a
        la FUENTE de la línea (CAM 1, VTR…) según su mapa de fuentes. CasparCG también lee la
        posición de los vídeos por OSC: en <code>casparcg.config</code> añade este servidor como
        cliente OSC en el puerto indicado.
      </p>
      {list.isPending ? (
        <Spinner label="Cargando…" />
      ) : list.isError ? (
        <Alert tone="error">{errorMessage(list.error)}</Alert>
      ) : list.data.length === 0 && !form ? (
        <p className="rf-muted">Todavía no hay equipos.</p>
      ) : (
        <ul className="rf-sidelist__items">
          {list.data.map((d) => (
            <li key={d.id}>
              <div>
                <strong>{d.name}</strong> <Badge>{DEVICE_KIND_LABEL[d.kind]}</Badge>{' '}
                <Badge tone={d.status.connected ? 'success' : d.enabled ? 'danger' : 'muted'}>
                  {d.status.connected ? 'Conectado' : d.enabled ? 'Sin conexión' : 'Desactivado'}
                </Badge>
                <span className="rf-muted rf-small">
                  {' '}
                  {deviceSummary(d)}
                  {d.status.version && ` · ${d.status.version}`}
                  {!d.status.connected && d.status.error && ` · ${d.status.error}`}
                </span>
              </div>
              <span className="rf-sidelist__confirm">
                <Button size="sm" onClick={() => open(toForm(d))}>
                  Editar
                </Button>
                {confirm === d.id ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      await api.delete(`/api/devices/${d.id}`).catch(() => undefined);
                      setConfirm(null);
                      void qc.invalidateQueries({ queryKey: devicesKey });
                    }}
                  >
                    Confirmar
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(d.id)}>
                    Quitar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form
          className="rf-config__device"
          onSubmit={onSave}
          aria-label={`Equipo ${DEVICE_KIND_LABEL[form.kind]}`}
        >
          <TextField
            label="Nombre"
            maxLength={60}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {field('host', 'Dirección (IP o nombre)', { required: true })}
          {form.kind === 'casparcg' && (
            <>
              {field('port', 'Puerto AMCP', num)}
              {field('oscPort', 'Puerto OSC (0 = sin OSC)', num)}
              {field('channel', 'Canal', num)}
              {field('vtr', 'Capa VTR', num)}
              {field('lower', 'Capa rótulos inferiores', num)}
              {field('banner', 'Capa banners', num)}
              {field('logo', 'Capa fecha/mosca', num)}
              {field('templateBaseUrl', 'Dirección de RunFlow vista desde CasparCG (opcional)', {
                placeholder: 'http://192.168.1.20:8080',
              })}
            </>
          )}
          {form.kind === 'obs' && (
            <>
              {field('port', 'Puerto de obs-websocket', num)}
              {field('password', 'Contraseña de obs-websocket', {
                type: 'password',
                autoComplete: 'off',
              })}
              <label className="rf-check">
                <input
                  type="checkbox"
                  checked={!!form.b.studioMode}
                  onChange={(e) =>
                    setForm({ ...form, b: { ...form.b, studioMode: e.target.checked } })
                  }
                />
                <span>Modo estudio: la escena va a previo y se lanza la transición</span>
              </label>
            </>
          )}
          {form.kind === 'vmix' && (
            <>
              {field('port', 'Puerto de la API TCP', num)}
              {select(
                'transition',
                'Transición',
                VMIX_TRANSITIONS.map((t) => ({
                  value: t,
                  label: t === 'CutDirect' ? 'Corte directo' : t,
                })),
              )}
              {field('durationMs', 'Duración de la transición (ms)', num)}
            </>
          )}
          {form.kind === 'atem' && (
            <>
              {field('me', 'M/E', { type: 'number', min: 1, max: 4 })}
              {select('transition', 'Transición', [
                { value: 'cut', label: 'Corte directo a programa' },
                { value: 'auto', label: 'Previo + AUTO' },
              ])}
            </>
          )}
          {form.kind !== 'casparcg' && (
            <fieldset className="rf-config__sources">
              <legend>Mapa de fuentes</legend>
              <p className="rf-muted rf-small">{INPUT_HINT[form.kind]}</p>
              {form.sources.map(([k, v], i) => (
                <div key={i} className="rf-config__source">
                  <input
                    className="rf-input"
                    aria-label={`Fuente ${i + 1}`}
                    value={k}
                    placeholder="CAM 1"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sources: form.sources.map((s, j) => (j === i ? [e.target.value, s[1]] : s)),
                      })
                    }
                  />
                  <span aria-hidden="true">→</span>
                  <input
                    className="rf-input"
                    aria-label={`Entrada para ${k || `la fuente ${i + 1}`}`}
                    value={v}
                    list={inputs ? 'rf-mixer-inputs' : undefined}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sources: form.sources.map((s, j) => (j === i ? [s[0], e.target.value] : s)),
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Quitar ${k || 'fuente'}`}
                    onClick={() =>
                      setForm({ ...form, sources: form.sources.filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </Button>
                </div>
              ))}
              {inputs && (
                <datalist id="rf-mixer-inputs">
                  {inputs.map((i) => (
                    <option key={i} value={i.split(' · ')[0]}>
                      {i}
                    </option>
                  ))}
                </datalist>
              )}
              <div className="rf-form__actions">
                <Button
                  size="sm"
                  onClick={() => setForm({ ...form, sources: [...form.sources, ['', '']] })}
                >
                  + Fuente
                </Button>
                {form.id && (
                  <Button size="sm" variant="ghost" onClick={() => void loadInputs()}>
                    Leer entradas del mezclador
                  </Button>
                )}
              </div>
            </fieldset>
          )}
          <label className="rf-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Activado</span>
          </label>
          <div className="rf-form__actions">
            <Button type="submit" variant="primary" loading={busy}>
              Guardar equipo
            </Button>
            <Button type="button" onClick={() => void onTest()}>
              Probar conexión
            </Button>
            <Button type="button" variant="ghost" onClick={() => open(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    </section>
  );
}
