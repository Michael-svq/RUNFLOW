import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import type {
  LiveState,
  OutputSettings,
  PrompterState,
  PublicOutputDto,
  RundownDto,
  StageMessage,
} from '@runflow/core';
import { api, ApiError, errorMessage } from '../api/client';
import { FullScreenError, FullScreenLoader } from '../components/FullScreen';
import {
  MSG_LIVE,
  MSG_OUTPUT_SETTINGS,
  MSG_PROMPTER,
  MSG_STAGE,
  onCustom,
} from '../outputs/protocol';
import { PrompterView, useFollowPrompter, usePrompterBlocks } from '../outputs/Prompter';
import {
  AgendaView,
  ClocksView,
  ControlView,
  MessageView,
  MultiView,
  PresenterView,
} from '../outputs/Views';
import { useTiming } from '../rundown/live';
import { useLines } from '../rundown/useRundownDoc';
import { useServerNow } from '../rundown/useServerClock';

/**
 * Salida por enlace (sin usuario): /salida/:token
 * Pantalla completa para el cristal del teleprompter, una TV o una tablet.
 */
export function OutputPage() {
  const { token = '' } = useParams();
  const [output, setOutput] = useState<PublicOutputDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.output = '1';
    api
      .get<{ output: PublicOutputDto }>(`/api/public/outputs/${encodeURIComponent(token)}`)
      .then((r) => setOutput(r.output))
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'Enlace no válido o revocado.'
            : errorMessage(err),
        ),
      );
    return () => {
      delete document.documentElement.dataset.output;
    };
  }, [token]);

  if (error) return <FullScreenError message={error} />;
  if (!output) return <FullScreenLoader />;
  return <OutputScreen token={token} output={output} />;
}

function OutputScreen({ token, output }: { token: string; output: PublicOutputDto }) {
  const [state, setState] = useState<{
    doc: Y.Doc;
    provider: WebsocketProvider;
  } | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [prompter, setPrompter] = useState<PrompterState | null>(null);
  const [message, setMessage] = useState<StageMessage | null>(null);
  const [settings, setSettings] = useState<OutputSettings>(output.settings);
  const [status, setStatus] = useState<'online' | 'offline' | 'revoked'>('offline');

  useEffect(() => {
    const doc = new Y.Doc();
    const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/collab-output`;
    const provider = new WebsocketProvider(base, token, doc, { maxBackoffTime: 5000 });
    onCustom<LiveState>(provider, MSG_LIVE, setLive);
    onCustom<PrompterState | null>(provider, MSG_PROMPTER, setPrompter);
    onCustom<StageMessage | null>(provider, MSG_STAGE, setMessage);
    onCustom<OutputSettings>(provider, MSG_OUTPUT_SETTINGS, setSettings);
    // Chat, RunFlow CG y mezcladores: estas pantallas no los usan.
    for (const type of [104, 105, 106]) onCustom(provider, type, () => undefined);
    provider.on('status', ({ status: s }: { status: string }) => {
      setStatus((prev) => (prev === 'revoked' ? prev : s === 'connected' ? 'online' : 'offline'));
    });
    provider.on('connection-close', (e: CloseEvent | null) => {
      if (e && e.code >= 4400 && e.code < 4500) setStatus('revoked');
    });
    setState({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [token]);

  const lines = useLines(state?.doc);
  const now = useServerNow(250);
  const rundown = useMemo(() => ({ ...output.rundown }) as unknown as RundownDto, [output.rundown]);
  const timing = useTiming(lines, rundown, live, Math.floor(now / 1000) * 1000);
  const blocks = usePrompterBlocks(state?.doc, lines, settings.showEmpty);
  const scrollRef = useRef<HTMLDivElement>(null);
  useFollowPrompter(scrollRef, prompter, live, settings, blocks);

  // La pantalla no se apaga mientras se muestra la salida.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    nav.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => undefined);
    return () => void lock?.release();
  }, []);

  if (status === 'revoked') return <FullScreenError message="Esta salida se ha revocado." />;

  const common = { rundown, lines, live, timing, now };
  return (
    <div className={`rf-output rf-output--${output.kind}`} data-status={status}>
      {output.kind === 'prompter' && (
        <PrompterView blocks={blocks} settings={settings} live={live} scrollRef={scrollRef} />
      )}
      {output.kind === 'clocks' && <ClocksView {...common} />}
      {output.kind === 'agenda' && <AgendaView rundown={rundown} lines={lines} timing={timing} />}
      {output.kind === 'messages' && <MessageView message={message} now={now} />}
      {output.kind === 'presenter' && (
        <PresenterView
          {...common}
          blocks={blocks}
          settings={settings}
          message={message}
          scrollRef={scrollRef}
        />
      )}
      {output.kind === 'control' && <ControlView token={token} {...common} />}
      {output.kind === 'multiview' && (
        <MultiView
          {...common}
          blocks={blocks}
          settings={settings}
          message={message}
          scrollRef={scrollRef}
        />
      )}
      {status === 'offline' && <div className="rf-output__offline">● Sin conexión</div>}
    </div>
  );
}
