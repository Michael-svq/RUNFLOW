import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GRAPHIC_TYPES,
  type CasparConfig,
  type CgDesign,
  type DeviceDto,
  type OrgSettings,
} from '@runflow/core';
import { Alert, Badge, Button, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { PageHeader } from '../components/PageHeader';

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
        intro="Opciones Master de la empresa: rótulos, directo, diseño de la grafía y equipos del estudio."
      />
      {settings.isPending ? (
        <Spinner label="Cargando…" />
      ) : settings.isError ? (
        <Alert tone="error">{errorMessage(settings.error)}</Alert>
      ) : (
        <>
          <LiveSettings settings={settings.data} />
          <DesignEditor settings={settings.data} />
          <Devices />
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

const emptyDevice = (): DeviceForm => ({
  id: null,
  name: 'CasparCG',
  enabled: true,
  host: '127.0.0.1',
  port: '5250',
  oscPort: '6250',
  channel: '1',
  vtr: '10',
  lower: '20',
  banner: '30',
  logo: '40',
  templateBaseUrl: '',
});

interface DeviceForm {
  id: string | null;
  name: string;
  enabled: boolean;
  host: string;
  port: string;
  oscPort: string;
  channel: string;
  vtr: string;
  lower: string;
  banner: string;
  logo: string;
  templateBaseUrl: string;
}

const toForm = (d: DeviceDto): DeviceForm => ({
  id: d.id,
  name: d.name,
  enabled: d.enabled,
  host: d.config.host,
  port: String(d.config.port),
  oscPort: String(d.config.oscPort),
  channel: String(d.config.channel),
  vtr: String(d.config.layers.vtr),
  lower: String(d.config.layers.lower),
  banner: String(d.config.layers.banner),
  logo: String(d.config.layers.logo),
  templateBaseUrl: d.config.templateBaseUrl,
});

const toConfig = (f: DeviceForm): CasparConfig => ({
  host: f.host.trim(),
  port: Number(f.port),
  oscPort: Number(f.oscPort),
  channel: Number(f.channel),
  layers: {
    vtr: Number(f.vtr),
    lower: Number(f.lower),
    banner: Number(f.banner),
    logo: Number(f.logo),
  },
  templateBaseUrl: f.templateBaseUrl.trim(),
});

function Devices() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: devicesKey,
    queryFn: async () => (await api.get<{ devices: DeviceDto[] }>('/api/devices')).devices,
    refetchInterval: 5000,
  });
  const [form, setForm] = useState<DeviceForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<string | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        name: form.name,
        kind: 'casparcg',
        enabled: form.enabled,
        config: toConfig(form),
      };
      if (form.id) await api.patch(`/api/devices/${form.id}`, body);
      else await api.post('/api/devices', body);
      setForm(null);
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
      const res = await api.post<{ ok: boolean; version?: string; clips?: number; error?: string }>(
        '/api/devices/test',
        { config: toConfig(form) },
      );
      setNotice(
        res.ok
          ? { tone: 'success', text: `Conectado: CasparCG ${res.version} · ${res.clips} clips` }
          : { tone: 'error', text: `Sin conexión: ${res.error}` },
      );
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    }
  }

  const field = (key: keyof DeviceForm, label: string, extra: Record<string, unknown> = {}) => (
    <TextField
      label={label}
      value={String(form![key] ?? '')}
      onChange={(e) => setForm({ ...form!, [key]: e.target.value })}
      {...extra}
    />
  );

  return (
    <section className="rf-card rf-config">
      <div className="rf-config__head">
        <h2 className="rf-form__title">Equipos: CasparCG</h2>
        {!form && (
          <Button size="sm" onClick={() => setForm(emptyDevice())}>
            Añadir CasparCG
          </Button>
        )}
      </div>
      <p className="rf-muted rf-small">
        RunFlow controla CasparCG 2.3+ por AMCP (puerto 5250) y lee la posición de los vídeos por
        OSC: en <code>casparcg.config</code> añade este servidor como cliente OSC en el puerto
        indicado. Los mezcladores llegan en M8.
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
                <strong>{d.name}</strong>{' '}
                <Badge tone={d.status.connected ? 'success' : d.enabled ? 'danger' : 'muted'}>
                  {d.status.connected ? 'Conectado' : d.enabled ? 'Sin conexión' : 'Desactivado'}
                </Badge>
                <span className="rf-muted rf-small">
                  {' '}
                  {d.config.host}:{d.config.port} · canal {d.config.channel}
                  {d.status.version && ` · ${d.status.version}`}
                  {!d.status.connected && d.status.error && ` · ${d.status.error}`}
                </span>
              </div>
              <span className="rf-sidelist__confirm">
                <Button size="sm" onClick={() => setForm(toForm(d))}>
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
        <form className="rf-config__device" onSubmit={onSave} aria-label="Equipo CasparCG">
          {field('name', 'Nombre', { maxLength: 60, required: true })}
          {field('host', 'Dirección (IP o nombre)', { required: true })}
          {field('port', 'Puerto AMCP', { type: 'number', min: 1, max: 65535 })}
          {field('oscPort', 'Puerto OSC (0 = sin OSC)', { type: 'number', min: 0, max: 65535 })}
          {field('channel', 'Canal', { type: 'number', min: 1, max: 32 })}
          {field('vtr', 'Capa VTR', { type: 'number', min: 1 })}
          {field('lower', 'Capa rótulos inferiores', { type: 'number', min: 1 })}
          {field('banner', 'Capa banners', { type: 'number', min: 1 })}
          {field('logo', 'Capa fecha/mosca', { type: 'number', min: 1 })}
          {field('templateBaseUrl', 'Dirección de RunFlow vista desde CasparCG (opcional)', {
            placeholder: 'http://192.168.1.20:8080',
          })}
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
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    </section>
  );
}
