import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { outputSettings, type PrompterState, type RundownDto } from '@runflow/core';
import { Alert, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { MSG_PROMPTER, sendCustom } from '../outputs/protocol';
import { anchorAt, PrompterView, scrollTargetFor, usePrompterBlocks } from '../outputs/Prompter';
import { useLines, useRundownSession } from '../rundown/useRundownDoc';

const PREFS_KEY = 'rf-prompter-operator';

interface Prefs {
  fontSize: number;
  followLive: boolean;
}

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { fontSize: raw.fontSize ?? 48, followLive: raw.followLive ?? true };
  } catch {
    return { fontSize: 48, followLive: true };
  }
}

/**
 * Control del teleprompter (operador o presentador con tablet). Lo que se
 * mueve aquí lo siguen todas las salidas de prompter de la escaleta.
 */
export function PrompterPage() {
  const { id = '' } = useParams();
  const rundown = useQuery({
    queryKey: ['rundown', id],
    queryFn: async () => (await api.get<{ rundown: RundownDto }>(`/api/rundowns/${id}`)).rundown,
  });
  if (rundown.isPending) {
    return (
      <div className="rf-fullscreen">
        <Spinner label="Cargando…" />
      </div>
    );
  }
  if (rundown.isError) {
    return (
      <div className="rf-fullscreen">
        <Alert tone="error">{errorMessage(rundown.error)}</Alert>
      </div>
    );
  }
  return <PrompterOperator key={id} rundown={rundown.data} />;
}

function PrompterOperator({ rundown }: { rundown: RundownDto }) {
  const { me, org } = useSession();
  const user = useMemo(() => ({ id: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const { session, status, live, prompter } = useRundownSession(org.id, rundown.id, user);
  const lines = useLines(session?.doc);
  const [prefs, setPrefs] = useState(readPrefs);
  const settings = useMemo(
    () => outputSettings({ fontSize: prefs.fontSize, showEmpty: true }),
    [prefs.fontSize],
  );
  const blocks = usePrompterBlocks(session?.doc, lines, true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const seq = useRef(0);
  const lastSent = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const restored = useRef(false);
  const ctrl = useRef({ running, speed, followLive: prefs.followLive });
  ctrl.current = { running, speed, followLive: prefs.followLive };

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // sin almacenamiento
    }
  }, [prefs]);

  // Retoma la última posición conocida al abrir.
  useEffect(() => {
    if (restored.current || !prompter || !blocks.length || !scrollRef.current) return;
    const t = scrollTargetFor(scrollRef.current, prompter, settings.marker);
    if (t !== null) scrollRef.current.scrollTop = t;
    restored.current = true;
  }, [prompter, blocks, settings.marker]);

  // Seguir el GO: salta a la línea en aire.
  const onAir = live?.onAir?.lineId ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onAir || !prefs.followLive) return;
    const t = scrollTargetFor(el, { lineId: onAir, fraction: 0 }, settings.marker);
    if (t !== null) el.scrollTo({ top: t, behavior: 'smooth' });
  }, [onAir, prefs.followLive, settings.marker]);

  // Movimiento, mando/pedal y envío de la posición a las salidas.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let buttonDown = false;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const el = scrollRef.current;
      // Pedal o mando (Gamepad API): el eje controla la velocidad; el botón 0, marcha/paro.
      const pad = navigator.getGamepads?.().find((g) => g);
      if (pad) {
        const axis = pad.axes[1] ?? pad.axes[0] ?? 0;
        if (Math.abs(axis) > 0.15) {
          setSpeed(Math.round(-axis * 10));
          setRunning(true);
        }
        const pressed = !!pad.buttons[0]?.pressed;
        if (pressed && !buttonDown) setRunning((r) => !r);
        buttonDown = pressed;
      }
      if (el && ctrl.current.running && ctrl.current.speed) {
        const fontPx = parseFloat(getComputedStyle(el).fontSize) || 40;
        el.scrollTop += ctrl.current.speed * fontPx * 0.5 * dt;
      }
      if (el && session) {
        const anchor = anchorAt(el, settings.marker);
        const key = `${anchor.lineId}|${anchor.fraction.toFixed(3)}|${ctrl.current.running}|${ctrl.current.speed}|${ctrl.current.followLive}`;
        const since = now - lastSent.current.at;
        if ((key !== lastSent.current.key && since > 100) || since > 2000) {
          const state: PrompterState = { ...anchor, ...ctrl.current, seq: ++seq.current };
          if (sendCustom(session.provider, MSG_PROMPTER, state))
            lastSent.current = { key, at: now };
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session, settings.marker]);

  // Teclado.
  useEffect(() => {
    const jump = (delta: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const current = anchorAt(el, settings.marker).lineId;
      const idx = blocks.findIndex((b) => b.lineId === current);
      const target = blocks[Math.max(0, Math.min(blocks.length - 1, idx + delta))];
      if (!target) return;
      const t = scrollTargetFor(el, { lineId: target.lineId, fraction: 0 }, settings.marker);
      if (t !== null) el.scrollTo({ top: t, behavior: 'smooth' });
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setRunning((r) => !r);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSpeed((s) => Math.max(-10, s - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSpeed((s) => Math.min(10, s + 1));
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        jump(1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        jump(-1);
      } else if (e.key === 'Home' && onAir) {
        e.preventDefault();
        const el = scrollRef.current;
        const t = el && scrollTargetFor(el, { lineId: onAir, fraction: 0 }, settings.marker);
        if (el && t !== null && t !== undefined) el.scrollTo({ top: t, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocks, settings.marker, onAir]);

  return (
    <div className="rf-prompter-op">
      <header className="rf-prompter-op__bar">
        <Link to={`/escaletas/${rundown.id}`} className="rf-rundown__back">
          ‹ Escaleta
        </Link>
        <strong className="rf-prompter-op__title">{rundown.title} · Prompter</strong>
        <button
          type="button"
          className={`rf-prompter-op__run${running ? ' is-running' : ''}`}
          onClick={() => setRunning((r) => !r)}
          aria-pressed={running}
          data-testid="prompter-run"
        >
          {running ? '❚❚ Parar' : '▶ Marcha'}
        </button>
        <label className="rf-prompter-op__field">
          Velocidad
          <input
            type="range"
            min={-10}
            max={10}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label="Velocidad"
          />
          <span className="rf-tabular">{speed}</span>
        </label>
        <label className="rf-prompter-op__field">
          Letra
          <input
            type="range"
            min={20}
            max={120}
            value={prefs.fontSize}
            onChange={(e) => setPrefs((p) => ({ ...p, fontSize: Number(e.target.value) }))}
            aria-label="Tamaño de letra"
          />
        </label>
        <label className="rf-prompter-op__check">
          <input
            type="checkbox"
            checked={prefs.followLive}
            onChange={(e) => setPrefs((p) => ({ ...p, followLive: e.target.checked }))}
          />
          Seguir el GO
        </label>
        <select
          className="rf-select rf-prompter-op__jump"
          aria-label="Ir a la línea"
          value=""
          onChange={(e) => {
            const el = scrollRef.current;
            const t =
              el && scrollTargetFor(el, { lineId: e.target.value, fraction: 0 }, settings.marker);
            if (el && t !== null && t !== undefined) el.scrollTo({ top: t, behavior: 'smooth' });
          }}
        >
          <option value="">Ir a…</option>
          {blocks.map((b) => (
            <option key={b.lineId} value={b.lineId}>
              {b.num} · {b.name}
            </option>
          ))}
        </select>
        <span className={`rf-conn ${status === 'online' ? 'rf-conn--online' : 'rf-conn--offline'}`}>
          ● {status === 'online' ? 'En línea' : 'Sin conexión'}
        </span>
        <span className="rf-prompter-op__help">
          Espacio marcha/paro · ↑↓ velocidad · RePág/AvPág línea · Inicio en aire
        </span>
      </header>
      <div className="rf-prompter-op__screen">
        <PrompterView blocks={blocks} settings={settings} live={live} scrollRef={scrollRef} />
      </div>
    </div>
  );
}
