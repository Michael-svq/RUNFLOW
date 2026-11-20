import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { PublicScreenState } from '@runflow/core';
import { api, errorMessage } from '../api/client';

/* /pantalla/:token — cliente a pantalla completa de una pantalla o videowall (F3.3). */

export function ScreenPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<PublicScreenState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.screen = '1';
    let es: EventSource | null = null;
    let cancelled = false;
    api
      .get<{ state: PublicScreenState }>(`/api/public/screens/${token}`)
      .then((r) => {
        if (cancelled) return;
        setState(r.state);
        es = new EventSource(`/api/public/screens/${token}/events`);
        es.onmessage = (e) => {
          setOnline(true);
          setState(JSON.parse(e.data) as PublicScreenState);
        };
        es.addEventListener('gone', () => {
          es?.close();
          setError('Esta pantalla ya no existe o su enlace ha cambiado.');
        });
        // EventSource se reconecta solo; mientras tanto se mantiene lo último.
        es.onerror = () => setOnline(false);
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
      es?.close();
      delete document.documentElement.dataset.screen;
    };
  }, [token]);

  if (error) return <div className="rf-screen rf-screen--msg">{error}</div>;
  if (!state) return <div className="rf-screen" />;
  return (
    <div className="rf-screen" data-scene={state.scene ?? ''} aria-label={state.name}>
      <Content state={state} />
      {!online && <span className="rf-screen__offline" title="Reconectando…" />}
    </div>
  );
}

function Content({ state }: { state: PublicScreenState }) {
  const c = state.content;
  switch (c.type) {
    case 'none':
      return null;
    case 'clock':
      return <Clock timezone={state.timezone} />;
    case 'text':
      return (
        <div className="rf-screen__text" style={{ color: c.color, background: c.background }}>
          {c.text}
        </div>
      );
    case 'url':
      return <iframe className="rf-screen__frame" src={c.url} title={state.name} />;
    case 'media':
      return c.kind === 'image' ? (
        <img className="rf-screen__media" style={{ objectFit: c.fit }} src={c.src} alt="" />
      ) : c.kind === 'video' ? (
        <video
          key={c.src}
          className="rf-screen__media"
          style={{ objectFit: c.fit }}
          src={c.src}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : (
        <audio key={c.src} src={c.src} autoPlay loop />
      );
  }
}

function Clock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(t);
  }, []);
  const fmt = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
  return <div className="rf-screen__clock">{fmt.format(now)}</div>;
}
