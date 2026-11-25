import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  autoStep,
  CAMERA_SHUTTERS,
  DEFAULT_CAMERA_AUTO,
  type CameraAuto,
  type CameraDto,
  type CameraImage,
  type CameraProfile,
  type OrgSettings,
} from '@runflow/core';
import { Alert, Button, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { analyze, type Scopes } from '../cameras/scopes';
import { Histogram, Parade, Vectorscope, Waveform } from '../cameras/ScopeViews';
import { settingsKey } from './ConfigPage';

/*
 * Dirección TV → Control de cámara: mando PTZ, monitor de señal (histograma,
 * forma de onda, vectorscopio y RGB), ajustes de imagen con balances
 * automáticos, memorias copiables entre cámaras y control automático de la
 * señal según unos objetivos.
 */

const camerasKey = ['cameras'];
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // sin almacenamiento
    }
  },
};

export function CameraPage() {
  const queryClient = useQueryClient();
  const cameras = useQuery({
    queryKey: camerasKey,
    queryFn: async () => (await api.get<{ cameras: CameraDto[] }>('/api/cameras')).cameras,
    refetchInterval: 5000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(() => store.get('rf-camera'));
  const list = cameras.data ?? [];
  const camera = list.find((c) => c.id === selectedId) ?? list[0] ?? null;
  const apply = useCallback(
    (updated: CameraDto) =>
      queryClient.setQueryData<CameraDto[]>(camerasKey, (old) =>
        (old ?? []).map((c) => (c.id === updated.id ? updated : c)),
      ),
    [queryClient],
  );

  return (
    <>
      <PageHeader
        title="Control de cámara"
        intro="Mando PTZ, monitor de señal, imagen, balances, memorias y control automático."
        actions={
          list.length > 0 && (
            <div className="rf-tabs" role="tablist" aria-label="Cámaras">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={camera?.id === c.id}
                  className={`rf-tabs__tab${camera?.id === c.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedId(c.id);
                    store.set('rf-camera', c.id);
                  }}
                  title={c.error ?? undefined}
                >
                  <span
                    className={`rf-dot ${c.connected ? 'is-on' : 'is-off'}`}
                    aria-hidden="true"
                  />{' '}
                  {c.name}
                </button>
              ))}
            </div>
          )
        }
      />
      {cameras.isPending ? (
        <Spinner label="Cargando…" />
      ) : cameras.isError ? (
        <Alert tone="error">{errorMessage(cameras.error)}</Alert>
      ) : !camera ? (
        <section className="rf-card rf-tile">
          <h2 className="rf-tile__title">Sin cámaras</h2>
          <p className="rf-tile__body">
            Añade tus cámaras PTZ (VISCA sobre IP o Panasonic AW) en RunFlow Station → Equipos, con
            el tipo «Cámara PTZ». Para probar sin cámaras, elige el protocolo «Simulada».
          </p>
          <Link to="/station" className="rf-btn rf-btn--secondary rf-btn--sm">
            RunFlow Station
          </Link>
        </section>
      ) : (
        <CameraConsole key={camera.id} camera={camera} cameras={list} onCamera={apply} />
      )}
    </>
  );
}

/* ---------- Consola de una cámara ---------- */

function CameraConsole({
  camera,
  cameras,
  onCamera,
}: {
  camera: CameraDto;
  cameras: CameraDto[];
  onCamera: (c: CameraDto) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(
    async (method: 'post' | 'patch', path: string, body: unknown, target = camera.id) => {
      try {
        setError(null);
        const res = await api[method]<{ camera: CameraDto }>(`/api/cameras/${target}${path}`, body);
        onCamera(res.camera);
        return res.camera;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      }
    },
    [camera.id, onCamera],
  );
  const setImage = useCallback(
    (patch: Partial<CameraImage>, target = camera.id) => call('patch', '/image', patch, target),
    [call, camera.id],
  );

  const [auto, setAutoState] = useState<CameraAuto>(() => {
    try {
      return {
        ...DEFAULT_CAMERA_AUTO,
        ...JSON.parse(store.get(`rf-cam-auto-${camera.id}`) ?? '{}'),
      };
    } catch {
      return DEFAULT_CAMERA_AUTO;
    }
  });
  const setAuto = (next: CameraAuto) => {
    setAutoState(next);
    store.set(`rf-cam-auto-${camera.id}`, JSON.stringify(next));
  };
  const [autoOn, setAutoOn] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [scopes, setScopes] = useState<Scopes | null>(null);

  // Control automático: un paso cada vez que llega una imagen nueva (como mucho cada 0,7 s).
  const lastAuto = useRef(0);
  const busy = useRef(false);
  // Cada cambio de ajustes invalida las imágenes pedidas antes (aún no lo reflejan).
  const changedAt = useRef(0);
  useEffect(() => {
    changedAt.current = Date.now();
  }, [camera.state.image]);
  useEffect(() => {
    if (!autoOn || !scopes || busy.current || Date.now() - lastAuto.current < 700) return;
    if ((scopes.at ?? 0) < changedAt.current + 100) return;
    lastAuto.current = Date.now();
    const step = autoStep(scopes.stats, camera.state.image, auto);
    if (!step) {
      setAutoStatus('Señal dentro de los objetivos');
      return;
    }
    setAutoStatus(step.reason);
    if (!Object.keys(step.patch).length) return;
    busy.current = true;
    void setImage(step.patch).finally(() => {
      busy.current = false;
    });
  }, [scopes, autoOn, auto, camera.state.image, setImage]);

  return (
    <div className="rf-cam">
      <div className="rf-cam__main">
        <SignalMonitor camera={camera} onScopes={setScopes} />
        {error && <Alert tone="error">{error}</Alert>}
        <ScopesPanel scopes={scopes} />
      </div>
      <aside className="rf-cam__side">
        <PtzPanel camera={camera} call={call} />
        <ImagePanel
          camera={camera}
          cameras={cameras}
          setImage={setImage}
          balance={(kind) => void call('post', '/balance', { kind })}
        />
        <section className="rf-card rf-cam__panel" aria-label="Control automático">
          <div className="rf-cam__panel-head">
            <h2 className="rf-tile__title">Control automático</h2>
            <label className="rf-livebar__check">
              <input
                type="checkbox"
                checked={autoOn}
                onChange={(e) => {
                  setAutoOn(e.target.checked);
                  setAutoStatus(e.target.checked ? 'Midiendo la señal…' : null);
                }}
              />
              Activar
            </label>
          </div>
          <p className="rf-muted rf-small">
            Ajusta diafragma, ganancia y color para mantener la señal dentro de estos objetivos.
          </p>
          <AutoFields auto={auto} onChange={setAuto} />
          {autoOn && autoStatus && (
            <p className="rf-cam__status" role="status">
              {autoStatus}
            </p>
          )}
        </section>
        <ProfilesPanel
          camera={camera}
          cameras={cameras}
          auto={auto}
          setImage={setImage}
          onLoadAuto={setAuto}
        />
      </aside>
    </div>
  );
}

/* ---------- Monitor de señal ---------- */

const ANALYSIS = { w: 256, h: 144 };

function SignalMonitor({
  camera,
  onScopes,
}: {
  camera: CameraDto;
  onScopes: (s: Scopes | null) => void;
}) {
  const display = useRef<HTMLCanvasElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [source, setSourceState] = useState<string>(
    () => store.get(`rf-cam-source-${camera.id}`) ?? (camera.snapshot ? 'camera' : 'none'),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const setSource = (s: string) => {
    setSourceState(s);
    store.set(`rf-cam-source-${camera.id}`, s);
  };

  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === 'videoinput')))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const analysis = document.createElement('canvas');
    analysis.width = ANALYSIS.w;
    analysis.height = ANALYSIS.h;
    const actx = analysis.getContext('2d', { willReadFrequently: true });
    let stopped = false;
    let timer = 0;
    const frame = (img: CanvasImageSource, at: number) => {
      const d = display.current?.getContext('2d');
      if (d && display.current)
        d.drawImage(img, 0, 0, display.current.width, display.current.height);
      if (!actx) return;
      actx.drawImage(img, 0, 0, ANALYSIS.w, ANALYSIS.h);
      const data = actx.getImageData(0, 0, ANALYSIS.w, ANALYSIS.h).data;
      onScopes({ ...analyze(data, ANALYSIS.w, ANALYSIS.h), at });
    };
    setProblem(null);
    onScopes(null);

    if (source === 'camera') {
      const next = () => {
        if (stopped) return;
        const img = new Image();
        const at = Date.now();
        img.onload = () => {
          if (stopped) return;
          frame(img, at);
          timer = window.setTimeout(next, 350);
        };
        img.onerror = () => {
          if (stopped) return;
          setProblem('La cámara no da imagen ahora mismo.');
          timer = window.setTimeout(next, 2000);
        };
        img.src = `/api/cameras/${camera.id}/snapshot?t=${Date.now()}`;
      };
      next();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }
    if (source.startsWith('device:')) {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      let stream: MediaStream | null = null;
      navigator.mediaDevices
        ?.getUserMedia({ video: { deviceId: { exact: source.slice(7) } }, audio: false })
        .then((s) => {
          if (stopped) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          video.srcObject = s;
          void video.play();
          const loop = () => {
            if (stopped) return;
            // La captura llega con algo de retraso: se data un poco antes.
            if (video.readyState >= 2) frame(video, Date.now() - 300);
            timer = window.setTimeout(loop, 200);
          };
          loop();
        })
        .catch((err: unknown) =>
          setProblem(`No se puede abrir la entrada de vídeo: ${errorMessage(err)}`),
        );
      return () => {
        stopped = true;
        clearTimeout(timer);
        stream?.getTracks().forEach((t) => t.stop());
      };
    }
    return () => {
      stopped = true;
    };
  }, [source, camera.id, onScopes]);

  return (
    <section className="rf-card rf-cam__monitor" aria-label="Monitor">
      <div className="rf-cam__panel-head">
        <h2 className="rf-tile__title">
          {camera.name}{' '}
          <span className={`rf-small ${camera.connected ? 'rf-text-success' : 'rf-text-danger'}`}>
            ● {camera.connected ? 'conectada' : (camera.error ?? 'sin conexión')}
          </span>
        </h2>
        <label className="rf-graphics__pick">
          <span>Imagen</span>
          <select
            className="rf-select"
            aria-label="Fuente de imagen"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="none">Sin imagen</option>
            {camera.snapshot && <option value="camera">Imagen de la cámara</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={`device:${d.deviceId}`}>
                {d.label || `Entrada de vídeo ${i + 1}`}
              </option>
            ))}
            {!devices.length && <option value="device:">Entrada de vídeo del ordenador</option>}
          </select>
        </label>
      </div>
      <div className="rf-cam__screen">
        <canvas ref={display} width={640} height={360} aria-label="Imagen de la cámara" />
        {source === 'none' && (
          <p className="rf-cam__empty">
            Elige de dónde sale la imagen: la de la cámara o una entrada de vídeo (capturadora).
          </p>
        )}
      </div>
      {problem && <p className="rf-text-danger rf-small">{problem}</p>}
    </section>
  );
}

function ScopesPanel({ scopes }: { scopes: Scopes | null }) {
  const s = scopes?.stats;
  return (
    <section className="rf-card rf-cam__scopes" aria-label="Monitor de señal">
      <figure>
        <Histogram scopes={scopes} />
        <figcaption>Histograma</figcaption>
      </figure>
      <figure>
        <Waveform scopes={scopes} />
        <figcaption>Forma de onda</figcaption>
      </figure>
      <figure>
        <Vectorscope scopes={scopes} />
        <figcaption>Vectorscopio</figcaption>
      </figure>
      <figure>
        <Parade scopes={scopes} />
        <figcaption>RGB</figcaption>
      </figure>
      <p className="rf-cam__stats rf-tabular" data-testid="signal-stats">
        {s ? (
          <>
            Luma <strong>{s.luma.toFixed(0)} %</strong> · Quemado {s.clipHigh.toFixed(1)} % ·
            Empastado {s.clipLow.toFixed(1)} % · Color R {s.castR >= 0 ? '+' : ''}
            {s.castR.toFixed(1)} B {s.castB >= 0 ? '+' : ''}
            {s.castB.toFixed(1)}
          </>
        ) : (
          'Sin señal'
        )}
      </p>
    </section>
  );
}

/* ---------- PTZ ---------- */

type Call = (
  method: 'post' | 'patch',
  path: string,
  body: unknown,
  target?: string,
) => Promise<CameraDto | null>;

function PtzPanel({ camera, call }: { camera: CameraDto; call: Call }) {
  const [speed, setSpeed] = useState(0.6);
  const [saving, setSaving] = useState(false);
  const motion = useRef({ pan: 0, tilt: 0, zoom: 0, focus: 0 });
  const lastSent = useRef(0);
  const pending = useRef(0);
  const send = useCallback(() => {
    pending.current = 0;
    lastSent.current = Date.now();
    const m = motion.current;
    void call('post', '/move', {
      pan: m.pan * speed,
      tilt: m.tilt * speed,
      zoom: m.zoom * speed,
      focus: m.focus * speed,
    });
  }, [call, speed]);
  /** Cambia el movimiento; las paradas salen al momento y el resto, como mucho cada 120 ms. */
  const push = useCallback(
    (patch: Partial<typeof motion.current>) => {
      motion.current = { ...motion.current, ...patch };
      const stop = Object.values(patch).every((v) => v === 0);
      const wait = 120 - (Date.now() - lastSent.current);
      if (stop || wait <= 0) {
        clearTimeout(pending.current);
        send();
      } else if (!pending.current) {
        pending.current = window.setTimeout(send, wait);
      }
    },
    [send],
  );
  const hold = (patch: Partial<typeof motion.current>, label: string, children: ReactNode) => {
    const stop = Object.fromEntries(Object.keys(patch).map((k) => [k, 0]));
    return (
      <button
        type="button"
        className="rf-cam__hold"
        aria-label={label}
        title={label}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          push(patch);
        }}
        onPointerUp={() => push(stop)}
        onPointerCancel={() => push(stop)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) push(patch);
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') push(stop);
        }}
      >
        {children}
      </button>
    );
  };

  return (
    <section className="rf-card rf-cam__panel" aria-label="PTZ">
      <h2 className="rf-tile__title">Movimiento (PTZ)</h2>
      <div className="rf-cam__ptz">
        <Joystick onMove={(pan, tilt) => push({ pan, tilt })} />
        <div className="rf-cam__lens">
          <span className="rf-muted rf-small">Zoom</span>
          {hold({ zoom: 1 }, 'Zoom acercar (tele)', 'T +')}
          {hold({ zoom: -1 }, 'Zoom alejar (gran angular)', 'W −')}
          <span className="rf-muted rf-small">Foco</span>
          {hold({ focus: 1 }, 'Foco lejos', 'Lejos')}
          {hold({ focus: -1 }, 'Foco cerca', 'Cerca')}
          <div className="rf-segmented rf-cam__af" role="group" aria-label="Enfoque">
            <button
              type="button"
              className={`rf-segmented__item${camera.state.focusAuto ? ' is-active' : ''}`}
              aria-pressed={camera.state.focusAuto}
              onClick={() => void call('post', '/focus', { mode: 'auto' })}
            >
              AF
            </button>
            <button
              type="button"
              className={`rf-segmented__item${!camera.state.focusAuto ? ' is-active' : ''}`}
              aria-pressed={!camera.state.focusAuto}
              onClick={() => void call('post', '/focus', { mode: 'manual' })}
            >
              MF
            </button>
            <button
              type="button"
              className="rf-segmented__item"
              onClick={() => void call('post', '/focus', { mode: 'onepush' })}
              title="Enfoque automático una vez"
            >
              1×AF
            </button>
          </div>
        </div>
      </div>
      <label className="rf-cam__slider">
        <span>Velocidad</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
        <output>{Math.round(speed * 100)} %</output>
      </label>
      <div className="rf-cam__panel-head">
        <span className="rf-muted rf-small">
          Posiciones {saving ? '· pulsa una para GRABAR la posición actual' : ''}
        </span>
        <label className="rf-livebar__check">
          <input type="checkbox" checked={saving} onChange={(e) => setSaving(e.target.checked)} />
          Grabar posición
        </label>
      </div>
      <div className="rf-cam__presets" role="group" aria-label="Posiciones">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((slot) => {
          const stored = camera.state.presets.includes(slot);
          return (
            <button
              key={slot}
              type="button"
              className={`rf-cam__preset${stored ? ' is-stored' : ''}${saving ? ' is-saving' : ''}`}
              aria-label={`${saving ? 'Grabar' : 'Ir a'} posición ${slot}`}
              onClick={() => {
                void call('post', '/preset', { action: saving ? 'save' : 'recall', slot });
                if (saving) setSaving(false);
              }}
            >
              {slot}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Mando: arrastra desde el centro (velocidad según la distancia); al soltar, para. */
function Joystick({ onMove }: { onMove: (pan: number, tilt: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius;
    let y = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const dead = (v: number) => (Math.abs(v) < 0.08 ? 0 : Math.round(v * 100) / 100);
    setKnob({ x, y });
    onMove(dead(x), dead(-y));
  };
  const release = () => {
    active.current = false;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  const keys: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  return (
    <div
      ref={ref}
      className="rf-cam__joystick"
      role="slider"
      tabIndex={0}
      aria-label="Pan y tilt (arrastra o usa las flechas)"
      aria-valuetext={`pan ${Math.round(knob.x * 100)} %, tilt ${Math.round(-knob.y * 100)} %`}
      onPointerDown={(e) => {
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => active.current && at(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        const k = keys[e.key];
        if (!k || e.repeat) return;
        e.preventDefault();
        setKnob({ x: k[0], y: -k[1] });
        onMove(k[0], k[1]);
      }}
      onKeyUp={(e) => keys[e.key] && release()}
    >
      <span
        className="rf-cam__knob"
        style={{ transform: `translate(${knob.x * 50}px, ${knob.y * 50}px)` }}
      />
    </div>
  );
}

/* ---------- Imagen ---------- */

function ImagePanel({
  camera,
  cameras,
  setImage,
  balance,
}: {
  camera: CameraDto;
  cameras: CameraDto[];
  setImage: (patch: Partial<CameraImage>, target?: string) => Promise<CameraDto | null>;
  balance: (kind: 'white' | 'black') => void;
}) {
  const im = camera.state.image;
  const others = cameras.filter((c) => c.id !== camera.id);
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const time = (t: number | null) =>
    t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <section className="rf-card rf-cam__panel" aria-label="Imagen">
      <h2 className="rf-tile__title">Imagen</h2>
      <CamSlider
        label="Diafragma"
        min={0}
        max={100}
        step={1}
        value={im.iris}
        format={(v) => `${Math.round(v)} %`}
        onCommit={(iris) => void setImage({ iris })}
      />
      <CamSlider
        label="Ganancia"
        min={0}
        max={36}
        step={1}
        value={im.gainDb}
        format={(v) => `${Math.round(v)} dB`}
        onCommit={(gainDb) => void setImage({ gainDb })}
      />
      <label className="rf-cam__slider">
        <span>Obturador</span>
        <select
          className="rf-select"
          value={im.shutter}
          onChange={(e) => void setImage({ shutter: Number(e.target.value) })}
        >
          {CAMERA_SHUTTERS.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <CamSlider
        label="Rojo"
        min={-50}
        max={50}
        step={1}
        value={im.rGain}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
        onCommit={(rGain) => void setImage({ rGain })}
      />
      <CamSlider
        label="Azul"
        min={-50}
        max={50}
        step={1}
        value={im.bGain}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
        onCommit={(bGain) => void setImage({ bGain })}
      />
      <CamSlider
        label="Pedestal"
        min={-50}
        max={50}
        step={1}
        value={im.pedestal}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
        onCommit={(pedestal) => void setImage({ pedestal })}
      />
      <CamSlider
        label="Detalle"
        min={0}
        max={100}
        step={1}
        value={im.detail}
        format={(v) => `${Math.round(v)} %`}
        onCommit={(detail) => void setImage({ detail })}
      />
      <div className="rf-form__actions">
        <Button size="sm" variant="secondary" onClick={() => balance('white')}>
          Balance de blancos (AWB)
        </Button>
        <Button size="sm" variant="secondary" onClick={() => balance('black')}>
          Balance de negros (ABB)
        </Button>
      </div>
      {(camera.state.whiteBalancedAt || camera.state.blackBalancedAt) && (
        <p className="rf-muted rf-small">
          {camera.state.whiteBalancedAt && `Blancos a las ${time(camera.state.whiteBalancedAt)}. `}
          {camera.state.blackBalancedAt && `Negros a las ${time(camera.state.blackBalancedAt)}.`}
        </p>
      )}
      {others.length > 0 && (
        <fieldset className="rf-cam__copy">
          <legend className="rf-muted rf-small">Copiar estos ajustes a</legend>
          {others.map((c) => (
            <label key={c.id} className="rf-check">
              <input
                type="checkbox"
                checked={copyTo.includes(c.id)}
                onChange={(e) =>
                  setCopyTo((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)))
                }
              />
              <span>{c.name}</span>
            </label>
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={!copyTo.length}
            onClick={async () => {
              for (const id of copyTo) await setImage(im, id);
              setCopied(`Copiado a ${copyTo.length} cámara${copyTo.length > 1 ? 's' : ''}.`);
              setCopyTo([]);
            }}
          >
            Copiar
          </Button>
          {copied && <span className="rf-small rf-text-success">{copied}</span>}
        </fieldset>
      )}
    </section>
  );
}

/** Deslizador que manda el valor al soltar (y muestra el borrador mientras se mueve). */
function CamSlider({
  label,
  min,
  max,
  step,
  value,
  format,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const shown = draft ?? value;
  return (
    <label className="rf-cam__slider">
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{format(shown)}</output>
    </label>
  );
}

function AutoFields({ auto, onChange }: { auto: CameraAuto; onChange: (a: CameraAuto) => void }) {
  const num = (key: keyof CameraAuto, label: string, min: number, max: number, unit: string) => (
    <label className="rf-cam__slider">
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={auto[key] as number}
        onChange={(e) => onChange({ ...auto, [key]: Number(e.target.value) })}
      />
      <output>
        {auto[key] as number}
        {unit}
      </output>
    </label>
  );
  return (
    <>
      {num('lumaTarget', 'Nivel medio', 10, 90, ' %')}
      {num('tolerance', 'Margen', 1, 20, '')}
      {num('maxGainDb', 'Ganancia máxima', 0, 36, ' dB')}
      {num('clipLimit', 'Quemado permitido', 0, 30, ' %')}
      <label className="rf-check">
        <input
          type="checkbox"
          checked={auto.whiteBalance}
          onChange={(e) => onChange({ ...auto, whiteBalance: e.target.checked })}
        />
        <span>Corregir el color con las zonas neutras</span>
      </label>
    </>
  );
}

/* ---------- Memorias ---------- */

function ProfilesPanel({
  camera,
  cameras,
  auto,
  setImage,
  onLoadAuto,
}: {
  camera: CameraDto;
  cameras: CameraDto[];
  auto: CameraAuto;
  setImage: (patch: Partial<CameraImage>, target?: string) => Promise<CameraDto | null>;
  onLoadAuto: (a: CameraAuto) => void;
}) {
  const queryClient = useQueryClient();
  const canDevices = useCan('devices.configure');
  const canOrg = useCan('org.configure');
  const canSave = canDevices || canOrg;
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: async () => (await api.get<{ settings: OrgSettings }>('/api/org/settings')).settings,
  });
  const profiles = settings.data?.cameraProfiles ?? [];
  const [name, setName] = useState('');
  const [copyFor, setCopyFor] = useState<string | null>(null);
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const save = async (next: CameraProfile[]) => {
    try {
      const res = await api.patch<{ settings: OrgSettings }>('/api/org/settings', {
        cameraProfiles: next,
      });
      queryClient.setQueryData(settingsKey, res.settings);
      return true;
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
      return false;
    }
  };
  const apply = async (p: CameraProfile, targets: string[]) => {
    for (const id of targets) await setImage(p.image, id);
  };

  return (
    <section className="rf-card rf-cam__panel" aria-label="Memorias">
      <h2 className="rf-tile__title">Memorias de ajustes</h2>
      {profiles.length === 0 ? (
        <p className="rf-muted rf-small">Sin memorias. Graba los ajustes de esta cámara.</p>
      ) : (
        <ul className="rf-plain-list rf-cam__profiles">
          {profiles.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong>
              <span className="rf-cam__profile-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await apply(p, [camera.id]);
                    onLoadAuto(p.auto);
                    setNotice({ tone: 'success', text: `«${p.name}» leída en ${camera.name}.` });
                  }}
                >
                  Leer
                </Button>
                {cameras.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCopyFor(copyFor === p.id ? null : p.id);
                      setCopyTo([]);
                    }}
                  >
                    Copiar a…
                  </Button>
                )}
                {canSave && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Borrar la memoria ${p.name}`}
                    onClick={() => void save(profiles.filter((x) => x.id !== p.id))}
                  >
                    🗑
                  </Button>
                )}
              </span>
              {copyFor === p.id && (
                <div className="rf-cam__copy">
                  {cameras.map((c) => (
                    <label key={c.id} className="rf-check">
                      <input
                        type="checkbox"
                        checked={copyTo.includes(c.id)}
                        onChange={(e) =>
                          setCopyTo((l) =>
                            e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                  <Button
                    size="sm"
                    disabled={!copyTo.length}
                    onClick={async () => {
                      await apply(p, copyTo);
                      setNotice({
                        tone: 'success',
                        text: `«${p.name}» copiada a ${copyTo.length} cámara${copyTo.length > 1 ? 's' : ''}.`,
                      });
                      setCopyFor(null);
                    }}
                  >
                    Copiar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canSave && (
        <form
          className="rf-cam__save"
          onSubmit={async (e) => {
            e.preventDefault();
            const clean = name.trim();
            if (!clean) return;
            const profile: CameraProfile = {
              id: globalThis.crypto.randomUUID(),
              name: clean,
              image: camera.state.image,
              auto,
            };
            const others = profiles.filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
            if (await save([...others, profile])) {
              setName('');
              setNotice({
                tone: 'success',
                text: `Grabada «${clean}» con los ajustes de ${camera.name}.`,
              });
            }
          }}
        >
          <input
            className="rf-input"
            aria-label="Nombre de la memoria"
            placeholder="Plató día, exteriores…"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={!name.trim()}>
            Grabar ajustes actuales
          </Button>
        </form>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
    </section>
  );
}
