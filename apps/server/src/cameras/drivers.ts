import dgram from 'node:dgram';
import {
  CAMERA_PROTOCOLS,
  CAMERA_SHUTTERS,
  type CameraConfig,
  type CameraImage,
  type CameraMove,
} from '@runflow/core';
import { assertPublicUrl } from '../sources/feed';
import { SimulatedCamera } from './simulated';

/*
 * Controladores de cámara: VISCA sobre IP (UDP, Sony y compatibles),
 * Panasonic AW (HTTP CGI) y la cámara simulada del estudio virtual.
 * Los ajustes de imagen van en unidades de RunFlow y cada protocolo los
 * traduce a sus rangos.
 */

export interface CameraDriver {
  move(m: CameraMove): Promise<void>;
  preset(action: 'recall' | 'save', slot: number): Promise<void>;
  /** Manda los ajustes cambiados (`patch`); `full` es el estado completo. */
  image(patch: Partial<CameraImage>, full: CameraImage): Promise<void>;
  /** Balance automático; la simulada devuelve los ajustes resultantes. */
  balance(kind: 'white' | 'black'): Promise<Partial<CameraImage> | void>;
  focus(mode: 'auto' | 'manual' | 'onepush'): Promise<void>;
  /** Imagen fija (para el monitor de señal), si la cámara la da. */
  snapshot?(): Promise<{ type: string; body: Buffer | string }>;
  /** Comprueba que responde; devuelve un texto (modelo/versión). */
  probe(): Promise<string>;
  close(): void;
}

const TIMEOUT_MS = 3000;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/* ---------- VISCA sobre IP ---------- */

const nibbles = (v: number) => [0, 0, (v >> 4) & 0x0f, v & 0x0f];

/** Órdenes VISCA (sin la cabecera IP). */
export const visca = {
  panTilt(addr: number, pan: number, tilt: number): number[] {
    const ps = clamp(Math.round(Math.abs(pan) * 0x18), 1, 0x18);
    const ts = clamp(Math.round(Math.abs(tilt) * 0x17), 1, 0x17);
    const pd = pan < 0 ? 0x01 : pan > 0 ? 0x02 : 0x03;
    const td = tilt > 0 ? 0x01 : tilt < 0 ? 0x02 : 0x03;
    return [0x80 + addr, 0x01, 0x06, 0x01, ps, ts, pd, td, 0xff];
  },
  zoom(addr: number, z: number): number[] {
    const p = clamp(Math.round(Math.abs(z) * 7), 0, 7);
    return [0x80 + addr, 0x01, 0x04, 0x07, z > 0 ? 0x20 + p : z < 0 ? 0x30 + p : 0x00, 0xff];
  },
  focus(addr: number, f: number): number[] {
    const p = clamp(Math.round(Math.abs(f) * 7), 0, 7);
    return [0x80 + addr, 0x01, 0x04, 0x08, f > 0 ? 0x20 + p : f < 0 ? 0x30 + p : 0x00, 0xff];
  },
  focusMode(addr: number, mode: 'auto' | 'manual' | 'onepush'): number[] {
    return mode === 'onepush'
      ? [0x80 + addr, 0x01, 0x04, 0x18, 0x01, 0xff]
      : [0x80 + addr, 0x01, 0x04, 0x38, mode === 'auto' ? 0x02 : 0x03, 0xff];
  },
  preset(addr: number, action: 'recall' | 'save', slot: number): number[] {
    return [
      0x80 + addr,
      0x01,
      0x04,
      0x3f,
      action === 'save' ? 0x01 : 0x02,
      (slot - 1) & 0x7f,
      0xff,
    ];
  },
  aeManual: (addr: number) => [0x80 + addr, 0x01, 0x04, 0x39, 0x03, 0xff],
  wbManual: (addr: number) => [0x80 + addr, 0x01, 0x04, 0x35, 0x05, 0xff],
  wbOnePush: (addr: number) => [0x80 + addr, 0x01, 0x04, 0x35, 0x03, 0xff],
  wbTrigger: (addr: number) => [0x80 + addr, 0x01, 0x04, 0x10, 0x05, 0xff],
  /** Valor directo de 0x4B iris, 0x4C ganancia, 0x4A obturador, 0x43/0x44 R/B, 0x42 detalle. */
  direct: (addr: number, cmd: number, value: number) => [
    0x80 + addr,
    0x01,
    0x04,
    cmd,
    ...nibbles(value),
    0xff,
  ],
  powerInquiry: (addr: number) => [0x80 + addr, 0x09, 0x04, 0x00, 0xff],
};

/** Paquete VISCA sobre IP: cabecera de 8 bytes (tipo, longitud, secuencia). */
export function viscaPacket(payload: number[], seq: number, type = 0x0100): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(payload.length, 2);
  head.writeUInt32BE(seq >>> 0, 4);
  return Buffer.concat([head, Buffer.from(payload)]);
}

const VISCA_SHUTTER = [0x06, 0x07, 0x08, 0x09, 0x0b, 0x0d, 0x0f];

/** Traducción de los ajustes de RunFlow a VISCA (órdenes en el orden de envío). */
export function viscaImage(addr: number, patch: Partial<CameraImage>): number[][] {
  const out: number[][] = [];
  if (patch.iris !== undefined || patch.gainDb !== undefined || patch.shutter !== undefined) {
    out.push(visca.aeManual(addr));
  }
  if (patch.iris !== undefined)
    out.push(visca.direct(addr, 0x4b, Math.round((patch.iris / 100) * 0x11)));
  if (patch.gainDb !== undefined)
    out.push(visca.direct(addr, 0x4c, Math.round((patch.gainDb / 36) * 0x0f)));
  if (patch.shutter !== undefined)
    out.push(visca.direct(addr, 0x4a, VISCA_SHUTTER[patch.shutter] ?? VISCA_SHUTTER[0]!));
  if (patch.rGain !== undefined || patch.bGain !== undefined) out.push(visca.wbManual(addr));
  if (patch.rGain !== undefined)
    out.push(visca.direct(addr, 0x43, clamp(0x80 + Math.round(patch.rGain * 2.5), 0, 0xff)));
  if (patch.bGain !== undefined)
    out.push(visca.direct(addr, 0x44, clamp(0x80 + Math.round(patch.bGain * 2.5), 0, 0xff)));
  if (patch.detail !== undefined)
    out.push(visca.direct(addr, 0x42, Math.round((patch.detail / 100) * 0x0f)));
  return out;
}

class ViscaCamera implements CameraDriver {
  private readonly sock = dgram.createSocket('udp4');
  private seq = 0;
  private readonly addr: number;
  private readonly port: number;
  private replyWaiters: (() => void)[] = [];

  constructor(private readonly config: CameraConfig) {
    this.addr = config.address;
    this.port = config.port || 52381;
    this.sock.on('message', () => {
      const waiters = this.replyWaiters;
      this.replyWaiters = [];
      for (const w of waiters) w();
    });
    this.sock.on('error', () => undefined);
  }

  private async send(...payloads: number[][]): Promise<void> {
    if (!this.config.host) throw new Error('Falta la dirección de la cámara');
    for (const p of payloads) {
      const packet = viscaPacket(p, ++this.seq);
      await new Promise<void>((resolve, reject) =>
        this.sock.send(packet, this.port, this.config.host, (err) =>
          err ? reject(err) : resolve(),
        ),
      );
    }
  }

  move(m: CameraMove) {
    return this.send(
      visca.panTilt(this.addr, m.pan, m.tilt),
      visca.zoom(this.addr, m.zoom),
      visca.focus(this.addr, m.focus),
    );
  }
  preset(action: 'recall' | 'save', slot: number) {
    return this.send(visca.preset(this.addr, action, slot));
  }
  image(patch: Partial<CameraImage>) {
    return this.send(...viscaImage(this.addr, patch));
  }
  async balance(kind: 'white' | 'black') {
    if (kind === 'black') {
      throw new Error(
        'Esta cámara (VISCA) no tiene balance de negros automático: ajusta el pedestal',
      );
    }
    await this.send(visca.wbOnePush(this.addr), visca.wbTrigger(this.addr));
  }
  focus(mode: 'auto' | 'manual' | 'onepush') {
    return this.send(visca.focusMode(this.addr, mode));
  }
  async probe(): Promise<string> {
    const replied = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Sin respuesta VISCA (tiempo agotado)')),
        TIMEOUT_MS,
      );
      this.replyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Reinicia la secuencia y pregunta si está encendida.
    await new Promise<void>((resolve) =>
      this.sock.send(viscaPacket([0x01], 0, 0x0200), this.port, this.config.host, () => resolve()),
    );
    await this.send(visca.powerInquiry(this.addr));
    await replied;
    return 'VISCA sobre IP';
  }
  close() {
    try {
      this.sock.close();
    } catch {
      // ya cerrado
    }
  }
}

/* ---------- Panasonic AW (HTTP) ---------- */

const hex = (n: number, width: number) =>
  Math.round(n).toString(16).toUpperCase().padStart(width, '0');
/** Velocidad −1…1 → 01…99 (50 = parado). */
const awSpeed = (v: number) => String(clamp(Math.round(50 + v * 49), 1, 99)).padStart(2, '0');

/** Órdenes Panasonic: `ptz` (#…) o `cam` (O…). */
export function panasonicImage(patch: Partial<CameraImage>): { cgi: 'ptz' | 'cam'; cmd: string }[] {
  const out: { cgi: 'ptz' | 'cam'; cmd: string }[] = [];
  if (patch.iris !== undefined)
    out.push({ cgi: 'ptz', cmd: `#AXI${hex(0x555 + (patch.iris / 100) * (0xfff - 0x555), 3)}` });
  if (patch.gainDb !== undefined)
    out.push({ cgi: 'cam', cmd: `OGU:${hex(0x08 + patch.gainDb, 2)}` });
  if (patch.shutter !== undefined)
    out.push({ cgi: 'cam', cmd: `OSH:${patch.shutter === 0 ? '0' : hex(patch.shutter + 2, 1)}` });
  if (patch.rGain !== undefined)
    out.push({ cgi: 'cam', cmd: `ORI:${hex(clamp(0x96 + patch.rGain * 3, 0, 0x12c), 3)}` });
  if (patch.bGain !== undefined)
    out.push({ cgi: 'cam', cmd: `OBI:${hex(clamp(0x96 + patch.bGain * 3, 0, 0x12c), 3)}` });
  if (patch.pedestal !== undefined)
    out.push({ cgi: 'cam', cmd: `OTD:${hex(clamp(0x96 + patch.pedestal * 3, 0, 0x12c), 3)}` });
  if (patch.detail !== undefined) out.push({ cgi: 'cam', cmd: `ODT:${patch.detail > 0 ? 1 : 0}` });
  return out;
}

class PanasonicCamera implements CameraDriver {
  private readonly base: string;
  constructor(
    private readonly config: CameraConfig,
    private readonly opts: { allowPrivate: boolean },
  ) {
    const port = config.port || 80;
    this.base = `http://${config.host}${port === 80 ? '' : `:${port}`}`;
  }

  private async get(path: string): Promise<Response> {
    if (!this.config.host) throw new Error('Falta la dirección de la cámara');
    const url = `${this.base}${path}`;
    if (!this.opts.allowPrivate) await assertPublicUrl(url);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 400) throw new Error(`La cámara respondió ${res.status}`);
    return res;
  }

  private async cmd(cgi: 'ptz' | 'cam', cmd: string): Promise<string> {
    const res = await this.get(`/cgi-bin/aw_${cgi}?cmd=${encodeURIComponent(cmd)}&res=1`);
    const text = (await res.text()).trim();
    if (/^E[R0-9]/.test(text)) throw new Error(`La cámara no aceptó ${cmd} (${text})`);
    return text;
  }

  async move(m: CameraMove) {
    await this.cmd('ptz', `#PTS${awSpeed(m.pan)}${awSpeed(m.tilt)}`);
    await this.cmd('ptz', `#Z${awSpeed(m.zoom)}`);
    await this.cmd('ptz', `#F${awSpeed(m.focus)}`);
  }
  async preset(action: 'recall' | 'save', slot: number) {
    await this.cmd('ptz', `#${action === 'save' ? 'M' : 'R'}${String(slot - 1).padStart(2, '0')}`);
  }
  async image(patch: Partial<CameraImage>) {
    for (const c of panasonicImage(patch)) await this.cmd(c.cgi, c.cmd);
  }
  async balance(kind: 'white' | 'black') {
    await this.cmd('cam', kind === 'white' ? 'OWS' : 'OAS');
  }
  async focus(mode: 'auto' | 'manual' | 'onepush') {
    if (mode === 'onepush') {
      await this.cmd('ptz', '#D11');
      setTimeout(() => void this.cmd('ptz', '#D10').catch(() => undefined), 2000).unref?.();
      return;
    }
    await this.cmd('ptz', mode === 'auto' ? '#D11' : '#D10');
  }
  async snapshot() {
    const res = await this.get('/cgi-bin/camera?resolution=640');
    return {
      type: res.headers.get('content-type') ?? 'image/jpeg',
      body: Buffer.from(await res.arrayBuffer()),
    };
  }
  async probe() {
    const text = await this.cmd('cam', 'QID');
    return text.replace(/^OID:/, '') || 'Panasonic AW';
  }
  close() {}
}

export function createDriver(config: CameraConfig, opts: { allowPrivate: boolean }): CameraDriver {
  switch (config.protocol) {
    case 'visca':
      return new ViscaCamera(config);
    case 'panasonic':
      return new PanasonicCamera(config, opts);
    case 'simulated':
      return new SimulatedCamera();
  }
}

export const defaultPort = (config: CameraConfig) =>
  config.port || CAMERA_PROTOCOLS.find((p) => p.value === config.protocol)!.port;

export { CAMERA_SHUTTERS };
