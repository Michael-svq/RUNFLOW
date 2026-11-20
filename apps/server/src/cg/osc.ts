import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

/*
 * Receptor OSC (UDP) para la posición real de los vídeos de CasparCG:
 *   /channel/1/stage/layer/10/foreground/file/time  f f  (transcurrido, total)   [2.3]
 *   /channel/1/stage/layer/10/file/time             f f                          [2.0/2.1]
 */

export interface OscMessage {
  address: string;
  args: (number | string | boolean | null)[];
}

function readString(buf: Buffer, offset: number): [string, number] {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString('utf8', offset, end);
  return [str, (end + 4) & ~3];
}

/** Decodifica un paquete OSC (mensaje o «bundle»). */
export function decodeOsc(buf: Buffer): OscMessage[] {
  if (buf.length < 4) return [];
  if (buf.toString('utf8', 0, 8) === '#bundle\0') {
    const out: OscMessage[] = [];
    let offset = 16; // «#bundle» + marca de tiempo
    while (offset + 4 <= buf.length) {
      const size = buf.readInt32BE(offset);
      offset += 4;
      if (size <= 0 || offset + size > buf.length) break;
      out.push(...decodeOsc(buf.subarray(offset, offset + size)));
      offset += size;
    }
    return out;
  }
  let [address, offset] = readString(buf, 0);
  if (!address.startsWith('/')) return [];
  let tags = ',';
  if (offset < buf.length && buf[offset] === 0x2c) [tags, offset] = readString(buf, offset);
  const args: OscMessage['args'] = [];
  for (const t of tags.slice(1)) {
    if (t === 'f') {
      args.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (t === 'i') {
      args.push(buf.readInt32BE(offset));
      offset += 4;
    } else if (t === 'd') {
      args.push(buf.readDoubleBE(offset));
      offset += 8;
    } else if (t === 'h') {
      args.push(Number(buf.readBigInt64BE(offset)));
      offset += 8;
    } else if (t === 's') {
      const [s, next] = readString(buf, offset);
      args.push(s);
      offset = next;
    } else if (t === 'T') args.push(true);
    else if (t === 'F') args.push(false);
    else if (t === 'N') args.push(null);
    else break; // tipo no soportado: se ignora el resto
  }
  return [{ address, args }];
}

function pad(b: Buffer): Buffer {
  const extra = 4 - (b.length % 4);
  return Buffer.concat([b, Buffer.alloc(extra)]);
}

/** Codifica un mensaje OSC con números (f) — lo usa el simulador. */
export function encodeOsc(address: string, floats: number[]): Buffer {
  const head = pad(Buffer.from(address, 'utf8'));
  const tags = pad(Buffer.from(`,${'f'.repeat(floats.length)}`, 'utf8'));
  const args = Buffer.alloc(floats.length * 4);
  floats.forEach((f, i) => args.writeFloatBE(f, i * 4));
  return Buffer.concat([head, tags, args]);
}

const TIME_RE = /^\/channel\/(\d+)\/stage\/layer\/(\d+)(?:\/foreground)?\/file\/time$/;

export interface ClipTime {
  channel: number;
  layer: number;
  elapsed: number;
  total: number;
  from: string;
}

/** Escucha el OSC de CasparCG y emite `time` con la posición de cada capa. */
export class OscListener extends EventEmitter {
  private socket: dgram.Socket | undefined;
  error: string | null = null;

  constructor(readonly port: number) {
    super();
  }

  start(): void {
    if (this.socket || !this.port) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('error', (err) => {
      this.error = err.message;
      this.emit('error-status', err);
    });
    socket.on('message', (msg, rinfo) => {
      for (const m of decodeOsc(msg)) {
        const t = TIME_RE.exec(m.address);
        if (t && typeof m.args[0] === 'number' && typeof m.args[1] === 'number') {
          this.emit('time', {
            channel: Number(t[1]),
            layer: Number(t[2]),
            elapsed: m.args[0],
            total: m.args[1],
            from: rinfo.address,
          } satisfies ClipTime);
        }
      }
    });
    socket.bind(this.port);
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}
