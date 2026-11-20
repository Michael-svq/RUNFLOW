import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { StreamAction, VmixConfig } from '@runflow/core';
import type { MixerDriver } from './driver';

/*
 * vMix por su API TCP (puerto 8099): «FUNCTION CutDirect Input=2» → «FUNCTION OK …».
 * Más rápida que la API HTTP y con una sola conexión abierta.
 */

interface Pending {
  line: string;
  resolve(v: string): void;
  reject(e: Error): void;
  timer?: NodeJS.Timeout;
}

export class VmixDriver extends EventEmitter implements MixerDriver {
  private socket: net.Socket | undefined;
  private buffer = '';
  private queue: Pending[] = [];
  private current: Pending | undefined;
  private xmlLeft = 0;
  private xml = '';
  private retry: NodeJS.Timeout | undefined;
  private closed = false;
  connected = false;
  lastError: string | null = null;
  version: string | null = null;

  constructor(private readonly config: VmixConfig) {
    super();
  }

  connect(): void {
    if (this.closed || this.socket) return;
    const socket = net.createConnection({ host: this.config.host, port: this.config.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      this.emit('status');
      void this.send('VERSION')
        .then((v) => (this.version = `vMix ${v}`))
        .catch(() => undefined);
    });
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (err) => (this.lastError = err.message));
    socket.on('close', () => {
      const was = this.connected;
      this.connected = false;
      this.socket = undefined;
      this.buffer = '';
      const err = new Error(this.lastError ?? 'Conexión cerrada');
      this.current?.reject(err);
      this.current = undefined;
      for (const p of this.queue.splice(0)) p.reject(err);
      if (was || this.lastError) this.emit('status');
      if (!this.closed) {
        this.retry = setTimeout(() => this.connect(), 3000);
        this.retry.unref?.();
      }
    });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.socket?.destroy();
  }

  private send(line: string): Promise<string> {
    if (!this.connected)
      return Promise.reject(new Error(this.lastError ?? 'vMix no está conectado'));
    return new Promise((resolve, reject) => {
      this.queue.push({ line, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || !this.socket || !this.connected) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    next.timer = setTimeout(() => {
      this.lastError = 'vMix no responde';
      this.socket?.destroy();
    }, 3000);
    this.socket.write(`${next.line}\r\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      if (this.xmlLeft > 0) {
        if (this.buffer.length < this.xmlLeft) return;
        this.xml = this.buffer.slice(0, this.xmlLeft);
        this.buffer = this.buffer.slice(this.xmlLeft);
        this.xmlLeft = 0;
        this.finish(null, this.xml);
        continue;
      }
      const i = this.buffer.indexOf('\r\n');
      if (i < 0) return;
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 2);
      // «FUNCTION OK texto», «FUNCTION ER texto», «VERSION OK 27.0.0.49», «XML 1234»
      const m = /^(\w+)\s+(OK|ER|\d+)\s?(.*)$/.exec(line);
      if (!m) continue;
      if (m[1] === 'XML' && /^\d+$/.test(m[2]!)) {
        this.xmlLeft = Number(m[2]);
        continue;
      }
      this.finish(m[2] === 'ER' ? new Error(`vMix: ${m[3] || 'error'}`) : null, m[3] ?? '');
    }
  }

  private finish(err: Error | null, value: string): void {
    const current = this.current;
    this.current = undefined;
    if (current) {
      clearTimeout(current.timer);
      if (err) current.reject(err);
      else current.resolve(value);
    }
    this.pump();
  }

  async cut(input: string): Promise<void> {
    const fn = this.config.transition;
    const duration =
      fn === 'CutDirect' || fn === 'Cut' ? '' : `&Duration=${this.config.durationMs}`;
    await this.send(`FUNCTION ${fn} Input=${encodeURIComponent(input)}${duration}`);
  }

  async output(action: StreamAction): Promise<void> {
    const fn = {
      startStream: 'StartStreaming',
      stopStream: 'StopStreaming',
      startRecord: 'StartRecording',
      stopRecord: 'StopRecording',
    }[action];
    await this.send(`FUNCTION ${fn}`);
  }

  async outputStatus(): Promise<{ streaming: boolean; recording: boolean }> {
    const xml = await this.send('XML');
    return {
      streaming: /<streaming>True<\/streaming>/i.test(xml),
      recording: /<recording>True<\/recording>/i.test(xml),
    };
  }

  async inputs(): Promise<string[]> {
    const xml = await this.send('XML');
    return [...xml.matchAll(/<input [^>]*number="(\d+)"[^>]*title="([^"]*)"/g)].map(
      (m) => `${m[1]} · ${m[2]}`,
    );
  }
}

/** vMix simulado (API TCP) para pruebas. */
export class VmixSimulator {
  readonly received: { at: number; line: string }[] = [];
  program: string | null = null;
  streaming = false;
  recording = false;
  private server: net.Server | undefined;
  private sockets = new Set<net.Socket>();
  port = 0;

  async start(): Promise<number> {
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.setEncoding('utf8');
      socket.setNoDelay(true);
      let buf = '';
      socket.on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          this.received.push({ at: Date.now(), line });
          if (line === 'VERSION') socket.write('VERSION OK 27.0.0.49\r\n');
          else if (line === 'XML') {
            const xml = `<vmix><inputs><input key="a" number="1" title="CAM 1"/><input key="b" number="2" title="VTR"/></inputs><recording>${this.recording ? 'True' : 'False'}</recording><streaming>${this.streaming ? 'True' : 'False'}</streaming></vmix>`;
            socket.write(`XML ${Buffer.byteLength(xml)}\r\n${xml}`);
          } else if (/^FUNCTION (Start|Stop)(Streaming|Recording)$/.test(line)) {
            const [, verb, what] = /^FUNCTION (Start|Stop)(Streaming|Recording)$/.exec(line)!;
            if (what === 'Streaming') this.streaming = verb === 'Start';
            else this.recording = verb === 'Start';
            socket.write('FUNCTION OK Completed\r\n');
          } else if (line.startsWith('FUNCTION ')) {
            const input = /Input=([^&\s]+)/.exec(line)?.[1];
            if (input) this.program = decodeURIComponent(input);
            socket.write(`FUNCTION OK Completed\r\n`);
          } else socket.write(`${line.split(' ')[0]} ER Unknown\r\n`);
        }
      });
      socket.on('error', () => undefined);
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
