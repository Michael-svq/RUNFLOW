import { EventEmitter } from 'node:events';
import net from 'node:net';

/*
 * Cliente AMCP de CasparCG (2.3+) por TCP (puerto 5250).
 * CasparCG responde a las órdenes en orden: se envía una cada vez.
 *   200 … OK  → varias líneas de datos hasta una línea vacía
 *   201 … OK  → una línea de datos
 *   202 … OK  → sin datos
 *   4xx / 5xx → error
 */

export interface AmcpResponse {
  code: number;
  status: string;
  data: string[];
}

export class AmcpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

interface Pending {
  command: string;
  resolve(res: AmcpResponse): void;
  reject(err: Error): void;
  timer?: NodeJS.Timeout;
}

/** Texto entre comillas para un parámetro AMCP. */
export function amcpString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

export class AmcpClient extends EventEmitter {
  private socket: net.Socket | undefined;
  private buffer = '';
  private queue: Pending[] = [];
  private current: Pending | undefined;
  private response: (AmcpResponse & { expect: 'multi' | 'single' }) | null = null;
  private retry: NodeJS.Timeout | undefined;
  private closed = false;
  connected = false;
  lastError: string | null = null;

  constructor(
    readonly host: string,
    readonly port: number,
    private readonly options: { timeoutMs?: number; reconnectMs?: number } = {},
  ) {
    super();
  }

  connect(): void {
    if (this.closed || this.socket) return;
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);
    socket.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      this.emit('status');
      this.pump();
    });
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (err) => {
      this.lastError = err.message;
    });
    socket.on('close', () => {
      const was = this.connected;
      this.connected = false;
      this.socket = undefined;
      this.buffer = '';
      this.response = null;
      const lost = new Error(this.lastError ?? 'Conexión cerrada');
      this.current?.reject(lost);
      clearTimeout(this.current?.timer);
      this.current = undefined;
      for (const p of this.queue.splice(0)) p.reject(lost);
      if (was || this.lastError) this.emit('status');
      if (!this.closed) {
        this.retry = setTimeout(() => this.connect(), this.options.reconnectMs ?? 2000);
        this.retry.unref?.();
      }
    });
  }

  /** Espera a la conexión (o falla tras `timeoutMs`). */
  async ready(timeoutMs = 3000): Promise<void> {
    if (this.connected) return;
    this.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('status', onStatus);
        reject(new Error(this.lastError ?? 'CasparCG no responde'));
      }, timeoutMs);
      const onStatus = () => {
        clearTimeout(timer);
        this.off('status', onStatus);
        if (this.connected) resolve();
        else reject(new Error(this.lastError ?? 'CasparCG no responde'));
      };
      this.on('status', onStatus);
    });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.socket?.destroy();
  }

  send(command: string): Promise<AmcpResponse> {
    if (!this.connected) {
      return Promise.reject(new Error(this.lastError ?? 'CasparCG no está conectado'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || !this.connected || !this.socket) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    next.timer = setTimeout(() => {
      // Sin respuesta: se da por perdida la conexión.
      this.lastError = `Sin respuesta a «${next.command.split(' ')[0]}»`;
      this.socket?.destroy();
    }, this.options.timeoutMs ?? 3000);
    this.socket.write(`${next.command}\r\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    if (!this.response) {
      const m = /^(\d{3})\s?(.*)$/.exec(line);
      if (!m) return; // línea suelta (p. ej. datos de una orden anterior)
      const code = Number(m[1]);
      const status = m[2] ?? '';
      if (code === 200) {
        this.response = { code, status, data: [], expect: 'multi' };
      } else if (code === 201) {
        this.response = { code, status, data: [], expect: 'single' };
      } else {
        this.finish({ code, status, data: [] });
      }
      return;
    }
    if (this.response.expect === 'multi') {
      if (line === '') {
        const { expect: _e, ...res } = this.response;
        this.finish(res);
      } else this.response.data.push(line);
    } else {
      this.response.data.push(line);
      const { expect: _e, ...res } = this.response;
      this.finish(res);
    }
  }

  private finish(res: AmcpResponse): void {
    this.response = null;
    const current = this.current;
    this.current = undefined;
    if (current) {
      clearTimeout(current.timer);
      if (res.code >= 400) {
        current.reject(
          new AmcpError(res.code, `${current.command.split(' ')[0]}: ${res.code} ${res.status}`),
        );
      } else current.resolve(res);
    }
    this.pump();
  }
}

/* ---------- Órdenes ---------- */

export const amcp = {
  version: () => 'VERSION',
  cls: () => 'CLS',
  play: (ch: number, layer: number, clip?: string, opts: { loop?: boolean } = {}) =>
    clip
      ? `PLAY ${ch}-${layer} ${amcpString(clip)}${opts.loop ? ' LOOP' : ''}`
      : `PLAY ${ch}-${layer}`,
  /** Precarga en segundo plano (la siguiente PLAY de la capa la lanza al instante). */
  loadbg: (ch: number, layer: number, clip: string, opts: { loop?: boolean } = {}) =>
    `LOADBG ${ch}-${layer} ${amcpString(clip)}${opts.loop ? ' LOOP' : ''}`,
  pause: (ch: number, layer: number) => `PAUSE ${ch}-${layer}`,
  resume: (ch: number, layer: number) => `RESUME ${ch}-${layer}`,
  stop: (ch: number, layer: number) => `STOP ${ch}-${layer}`,
  clear: (ch: number, layer: number) => `CLEAR ${ch}-${layer}`,
  cgAdd: (ch: number, layer: number, template: string, data: unknown) =>
    `CG ${ch}-${layer} ADD 1 ${amcpString(template)} 1 ${amcpString(JSON.stringify(data))}`,
  cgStop: (ch: number, layer: number) => `CG ${ch}-${layer} STOP 1`,
  cgClear: (ch: number, layer: number) => `CG ${ch}-${layer} CLEAR`,
};

export interface ClipInfo {
  name: string;
  type: string;
  /** Segundos (frames / fps). */
  duration: number | null;
}

/** Interpreta la respuesta de CLS: `"CARPETA/CLIP" MOVIE 1234 20240101120000 250 1/25`. */
export function parseCls(lines: string[]): ClipInfo[] {
  const out: ClipInfo[] = [];
  for (const line of lines) {
    const m = /^"(.+)"\s+(\S+)\s+\S+\s+\S+\s+(\d+)\s+(\d+)\/(\d+)/.exec(line);
    if (m) {
      const frames = Number(m[3]);
      const num = Number(m[4]);
      const den = Number(m[5]);
      out.push({
        name: m[1]!,
        type: m[2]!,
        duration: frames && num && den ? (frames * num) / den : null,
      });
    } else {
      const simple = /^"(.+)"\s+(\S+)/.exec(line);
      if (simple) out.push({ name: simple[1]!, type: simple[2]!, duration: null });
    }
  }
  return out;
}
