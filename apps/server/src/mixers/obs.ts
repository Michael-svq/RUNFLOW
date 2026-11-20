import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
// Protocolo JSON (la entrada por defecto en Node usa MessagePack).
import OBSWebSocket from 'obs-websocket-js/json';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ObsConfig, StreamAction } from '@runflow/core';
import type { MixerDriver } from './driver';

/* OBS Studio por obs-websocket 5 (puerto 4455): cada fuente es una escena. */

export class ObsDriver extends EventEmitter implements MixerDriver {
  private readonly obs = new OBSWebSocket();
  private retry: NodeJS.Timeout | undefined;
  private closed = false;
  private connecting = false;
  connected = false;
  lastError: string | null = null;
  version: string | null = null;

  constructor(private readonly config: ObsConfig) {
    super();
    this.obs.on('ConnectionClosed', (err) => {
      const was = this.connected;
      this.connected = false;
      if (err?.message) this.lastError = err.message;
      if (was) this.emit('status');
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.closed) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), 3000);
    this.retry.unref?.();
  }

  connect(): void {
    if (this.closed || this.connected || this.connecting) return;
    this.connecting = true;
    this.obs
      .connect(`ws://${this.config.host}:${this.config.port}`, this.config.password || undefined, {
        rpcVersion: 1,
        eventSubscriptions: 0,
      })
      .then((hello) => {
        this.connected = true;
        this.lastError = null;
        this.version = `OBS · obs-websocket ${hello.obsWebSocketVersion}`;
        this.emit('status');
      })
      .catch((err: Error) => {
        this.lastError = err.message || 'OBS no responde';
        this.emit('status');
      })
      .finally(() => {
        this.connecting = false;
      });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    void this.obs.disconnect().catch(() => undefined);
  }

  async cut(input: string): Promise<void> {
    if (!this.connected) throw new Error(this.lastError ?? 'OBS no está conectado');
    if (this.config.studioMode) {
      await this.obs.call('SetCurrentPreviewScene', { sceneName: input });
      await this.obs.call('TriggerStudioModeTransition');
    } else {
      await this.obs.call('SetCurrentProgramScene', { sceneName: input });
    }
  }

  async output(action: StreamAction): Promise<void> {
    if (!this.connected) throw new Error(this.lastError ?? 'OBS no está conectado');
    const request = {
      startStream: 'StartStream',
      stopStream: 'StopStream',
      startRecord: 'StartRecord',
      stopRecord: 'StopRecord',
    } as const;
    await this.obs.call(request[action]);
  }

  async outputStatus(): Promise<{ streaming: boolean; recording: boolean }> {
    const [stream, record] = await Promise.all([
      this.obs.call('GetStreamStatus'),
      this.obs.call('GetRecordStatus'),
    ]);
    return { streaming: !!stream.outputActive, recording: !!record.outputActive };
  }

  async inputs(): Promise<string[]> {
    const res = await this.obs.call('GetSceneList');
    return (res.scenes as { sceneName: string }[]).map((s) => s.sceneName).reverse();
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('base64');

/** OBS simulado (obs-websocket 5, JSON) para pruebas. */
export class ObsSimulator {
  readonly requests: { at: number; type: string; data: unknown }[] = [];
  program = 'CAM 1';
  preview = '';
  streaming = false;
  recording = false;
  private wss: WebSocketServer | undefined;
  port = 0;

  constructor(
    private readonly options: {
      password?: string;
      scenes?: string[];
      port?: number;
      host?: string;
    } = {},
  ) {}

  async start(): Promise<number> {
    this.wss = new WebSocketServer({
      port: this.options.port ?? 0,
      host: this.options.host ?? '127.0.0.1',
      // obs-websocket-js pide el subprotocolo JSON.
      handleProtocols: (protocols) =>
        protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false,
    });
    await new Promise<void>((r) => this.wss!.once('listening', () => r()));
    this.port = (this.wss.address() as { port: number }).port;
    this.wss.on('connection', (ws) => this.onConnection(ws));
    return this.port;
  }

  async stop(): Promise<void> {
    for (const c of this.wss?.clients ?? []) c.terminate();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }

  private onConnection(ws: WebSocket): void {
    const salt = 'c2FsdA==';
    const challenge = 'Y2hhbGxlbmdl';
    const send = (op: number, d: unknown) => ws.send(JSON.stringify({ op, d }));
    send(0, {
      obsWebSocketVersion: '5.5.0',
      rpcVersion: 1,
      ...(this.options.password ? { authentication: { salt, challenge } } : {}),
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> };
      if (msg.op === 1) {
        if (this.options.password) {
          const expected = sha(sha(this.options.password + salt) + challenge);
          if (msg.d.authentication !== expected) return ws.close(4009, 'Authentication failed');
        }
        send(2, { negotiatedRpcVersion: 1 });
      } else if (msg.op === 6) {
        const { requestType, requestId, requestData } = msg.d as {
          requestType: string;
          requestId: string;
          requestData?: { sceneName?: string };
        };
        this.requests.push({ at: Date.now(), type: requestType, data: requestData });
        let responseData: unknown;
        if (requestType === 'SetCurrentProgramScene') this.program = requestData?.sceneName ?? '';
        else if (requestType === 'SetCurrentPreviewScene')
          this.preview = requestData?.sceneName ?? '';
        else if (requestType === 'TriggerStudioModeTransition') this.program = this.preview;
        else if (requestType === 'StartStream') this.streaming = true;
        else if (requestType === 'StopStream') this.streaming = false;
        else if (requestType === 'StartRecord') this.recording = true;
        else if (requestType === 'StopRecord') this.recording = false;
        else if (requestType === 'GetStreamStatus')
          responseData = { outputActive: this.streaming, outputTimecode: '00:00:00.000' };
        else if (requestType === 'GetRecordStatus')
          responseData = { outputActive: this.recording, outputTimecode: '00:00:00.000' };
        else if (requestType === 'GetSceneList')
          responseData = {
            scenes: (this.options.scenes ?? ['VTR', 'CAM 2', 'CAM 1']).map((sceneName, i) => ({
              sceneName,
              sceneIndex: i,
            })),
          };
        send(7, {
          requestType,
          requestId,
          requestStatus: { result: true, code: 100 },
          ...(responseData ? { responseData } : {}),
        });
      }
    });
  }
}
