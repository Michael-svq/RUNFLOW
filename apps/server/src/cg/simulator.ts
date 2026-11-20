import dgram from 'node:dgram';
import net from 'node:net';
import { encodeOsc } from './osc';

/*
 * CasparCG simulado (AMCP + OSC) para pruebas y para practicar sin equipos
 * (PLAN §31). Entiende las órdenes que usa RunFlow, guarda lo recibido y,
 * mientras un clip se reproduce, envía su posición por OSC.
 */

export interface SimClip {
  name: string;
  /** Segundos. */
  duration: number;
}

export interface SimCommand {
  at: number;
  command: string;
}

interface LayerState {
  clip: string | null;
  background: string | null;
  playing: boolean;
  startedAt: number;
  pausedAt: number | null;
  loop: boolean;
  template: string | null;
  templateData: string | null;
  templateVisible: boolean;
}

/** Lee los parámetros de una orden AMCP (respetando comillas y escapes). */
export function tokenize(command: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < command.length) {
    if (command[i] === ' ') {
      i++;
      continue;
    }
    if (command[i] === '"') {
      let s = '';
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length) {
          const n = command[i + 1]!;
          s += n === 'n' ? '\n' : n;
          i += 2;
        } else s += command[i++];
      }
      i++;
      out.push(s);
    } else {
      let s = '';
      while (i < command.length && command[i] !== ' ') s += command[i++];
      out.push(s);
    }
  }
  return out;
}

export class CasparSimulator {
  readonly commands: SimCommand[] = [];
  readonly layers = new Map<string, LayerState>();
  private server: net.Server | undefined;
  private sockets = new Set<net.Socket>();
  private osc: dgram.Socket | undefined;
  private oscTimer: NodeJS.Timeout | undefined;
  port = 0;

  constructor(
    private readonly options: {
      clips?: SimClip[];
      /** Puerto UDP al que enviar la posición de los clips (OSC). */
      oscPort?: number;
      /** Equipo al que enviar el OSC (por defecto, el propio). */
      oscHost?: string;
      version?: string;
    } = {},
  ) {}

  get clips(): SimClip[] {
    return this.options.clips ?? [];
  }

  async start(port = 0, host = '127.0.0.1'): Promise<number> {
    this.server = net.createServer((socket) => this.onSocket(socket));
    await new Promise<void>((resolve) => this.server!.listen(port, host, resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
    if (this.options.oscPort) {
      this.osc = dgram.createSocket('udp4');
      this.oscTimer = setInterval(() => this.sendOsc(), 100);
      this.oscTimer.unref();
    }
    return this.port;
  }

  async stop(): Promise<void> {
    clearInterval(this.oscTimer);
    this.osc?.close();
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  /** Corta las conexiones (simula que CasparCG se cae). */
  dropConnections(): void {
    for (const s of this.sockets) s.destroy();
  }

  layer(ch: number, layer: number): LayerState {
    const key = `${ch}-${layer}`;
    let l = this.layers.get(key);
    if (!l) {
      l = {
        clip: null,
        background: null,
        playing: false,
        startedAt: 0,
        pausedAt: null,
        loop: false,
        template: null,
        templateData: null,
        templateVisible: false,
      };
      this.layers.set(key, l);
    }
    return l;
  }

  /** Órdenes recibidas que empiezan por `prefix` (p. ej. "CG 1-20 ADD"). */
  sent(prefix: string): SimCommand[] {
    return this.commands.filter((c) => c.command.startsWith(prefix));
  }

  private onSocket(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (line.trim()) socket.write(this.handle(line.trim()));
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => undefined);
  }

  private findClip(name: string): SimClip | undefined {
    const n = name.toLowerCase();
    return this.clips.find((c) => c.name.toLowerCase() === n);
  }

  private handle(command: string): string {
    this.commands.push({ at: Date.now(), command });
    const t = tokenize(command);
    const verb = (t[0] ?? '').toUpperCase();
    const target = /^(\d+)(?:-(\d+))?$/.exec(t[1] ?? '');
    const ch = target ? Number(target[1]) : 1;
    const ly = target?.[2] ? Number(target[2]) : 0;
    switch (verb) {
      case 'VERSION':
        return `201 VERSION OK\r\n${this.options.version ?? '2.3.3 LTS (simulador RunFlow)'}\r\n`;
      case 'CLS':
        return `200 CLS OK\r\n${this.clips
          .map(
            (c) =>
              `"${c.name.toUpperCase()}" MOVIE 1000 20260101000000 ${Math.round(c.duration * 25)} 1/25\r\n`,
          )
          .join('')}\r\n`;
      case 'LOADBG': {
        const name = t[2] ?? '';
        if (!this.findClip(name)) return '404 LOADBG FAILED\r\n';
        const l = this.layer(ch, ly);
        l.background = name;
        l.loop = t.includes('LOOP');
        return '202 LOADBG OK\r\n';
      }
      case 'PLAY': {
        const l = this.layer(ch, ly);
        const name = t[2] && !['LOOP', 'AUTO'].includes(t[2]) ? t[2] : l.background;
        if (!name || !this.findClip(name)) return '404 PLAY FAILED\r\n';
        l.clip = name;
        l.background = null;
        l.playing = true;
        l.startedAt = Date.now();
        l.pausedAt = null;
        if (t.includes('LOOP')) l.loop = true;
        return '202 PLAY OK\r\n';
      }
      case 'PAUSE': {
        const l = this.layer(ch, ly);
        if (l.playing) l.pausedAt = Date.now();
        return '202 PAUSE OK\r\n';
      }
      case 'RESUME': {
        const l = this.layer(ch, ly);
        if (l.pausedAt) {
          l.startedAt += Date.now() - l.pausedAt;
          l.pausedAt = null;
        }
        return '202 RESUME OK\r\n';
      }
      case 'STOP':
      case 'CLEAR': {
        const l = this.layer(ch, ly);
        l.playing = false;
        l.clip = null;
        if (verb === 'CLEAR') {
          l.background = null;
          l.template = null;
          l.templateVisible = false;
        }
        return `202 ${verb} OK\r\n`;
      }
      case 'CG': {
        const l = this.layer(ch, ly);
        const sub = (t[2] ?? '').toUpperCase();
        if (sub === 'ADD') {
          l.template = t[4] ?? null;
          l.templateData = t[6] ?? null;
          l.templateVisible = t[5] === '1';
        } else if (sub === 'STOP') l.templateVisible = false;
        else if (sub === 'PLAY') l.templateVisible = true;
        else if (sub === 'CLEAR') {
          l.template = null;
          l.templateVisible = false;
        } else if (sub === 'UPDATE') l.templateData = t[4] ?? null;
        return '202 CG OK\r\n';
      }
      default:
        return `400 ERROR\r\n`;
    }
  }

  /** Posición del clip de una capa en segundos. */
  position(ch: number, layer: number): number | null {
    const l = this.layer(ch, layer);
    if (!l.playing || !l.clip) return null;
    const clip = this.findClip(l.clip);
    const now = l.pausedAt ?? Date.now();
    const elapsed = (now - l.startedAt) / 1000;
    if (!clip) return elapsed;
    return l.loop ? elapsed % clip.duration : Math.min(elapsed, clip.duration);
  }

  private sendOsc(): void {
    if (!this.osc || !this.options.oscPort) return;
    for (const [key, l] of this.layers) {
      if (!l.playing || !l.clip) continue;
      const [ch, ly] = key.split('-').map(Number) as [number, number];
      const clip = this.findClip(l.clip);
      const pos = this.position(ch, ly) ?? 0;
      const msg = encodeOsc(`/channel/${ch}/stage/layer/${ly}/foreground/file/time`, [
        pos,
        clip?.duration ?? 0,
      ]);
      this.osc.send(msg, this.options.oscPort, this.options.oscHost ?? '127.0.0.1');
    }
  }
}
