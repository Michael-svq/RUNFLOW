import {
  CAMERA_SHUTTERS,
  DEFAULT_CAMERA_IMAGE,
  type CameraImage,
  type CameraMove,
} from '@runflow/core';
import type { CameraDriver } from './drivers';

/*
 * Cámara simulada del estudio virtual: un plató dibujado en SVG que responde
 * al diafragma, la ganancia, el obturador, los balances y el pedestal, y que
 * se mueve con pan, tilt, zoom y foco. Así el monitor de señal y el control
 * automático se pueden probar sin cámaras.
 */

export interface SimScene {
  /** Luz del plató (1 = exposición correcta con diafragma 50 y 0 dB). */
  light: number;
  /** Dominante de color de la luz (rojo y azul respecto al verde). */
  tintR: number;
  tintB: number;
  /** Negro levantado (0–0.2). */
  black: number;
}

const WORLD = { w: 1600, h: 900 };
const LIMITS = { pan: 170, tilt: 60, zoomMin: 1, zoomMax: 6 };
/** Grados (o aumentos) por segundo a velocidad máxima. */
const RATE = { pan: 60, tilt: 40, zoom: 2.5, focus: 0.8 };

const seconds = (s: string) => {
  const [a, b] = s.split('/').map(Number);
  return (a ?? 1) / (b ?? 50);
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const n3 = (v: number) => Math.round(v * 1000) / 1000;

export class SimulatedCamera implements CameraDriver {
  pan = 0;
  tilt = 0;
  zoom = 1;
  focusPos = 0.5;
  focusAuto = true;
  settings: CameraImage = { ...DEFAULT_CAMERA_IMAGE };
  private speed: CameraMove = { pan: 0, tilt: 0, zoom: 0, focus: 0 };
  private last = Date.now();
  private readonly presets = new Map<number, { pan: number; tilt: number; zoom: number }>();

  constructor(readonly scene: SimScene = { light: 0.8, tintR: 0.14, tintB: -0.12, black: 0.05 }) {}

  /** Avanza las posiciones según las velocidades. */
  private integrate(): void {
    const now = Date.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (dt <= 0) return;
    this.pan = clamp(this.pan + this.speed.pan * RATE.pan * dt, -LIMITS.pan, LIMITS.pan);
    this.tilt = clamp(this.tilt + this.speed.tilt * RATE.tilt * dt, -LIMITS.tilt, LIMITS.tilt);
    this.zoom = clamp(this.zoom + this.speed.zoom * RATE.zoom * dt, LIMITS.zoomMin, LIMITS.zoomMax);
    this.focusPos = clamp(this.focusPos + this.speed.focus * RATE.focus * dt, 0, 1);
  }

  async move(m: CameraMove) {
    this.integrate();
    this.speed = { ...m };
  }

  async preset(action: 'recall' | 'save', slot: number) {
    this.integrate();
    if (action === 'save') {
      this.presets.set(slot, { pan: this.pan, tilt: this.tilt, zoom: this.zoom });
      return;
    }
    const p = this.presets.get(slot);
    if (!p) throw new Error(`La posición ${slot} está vacía`);
    this.speed = { pan: 0, tilt: 0, zoom: 0, focus: 0 };
    Object.assign(this, p);
  }

  async image(_patch: Partial<CameraImage>, full: CameraImage) {
    this.settings = { ...full };
  }

  /** Blancos: neutraliza la dominante; negros: deja el negro en su sitio. */
  async balance(kind: 'white' | 'black'): Promise<Partial<CameraImage>> {
    if (kind === 'white') {
      const patch = {
        rGain: Math.round((1 / (1 + this.scene.tintR) - 1) * 100),
        bGain: Math.round((1 / (1 + this.scene.tintB) - 1) * 100),
      };
      Object.assign(this.settings, patch);
      return patch;
    }
    const patch = { pedestal: -Math.round(this.scene.black * 200) };
    Object.assign(this.settings, patch);
    return patch;
  }

  async focus(mode: 'auto' | 'manual' | 'onepush') {
    if (mode === 'onepush') this.focusPos = 0.5;
    else this.focusAuto = mode === 'auto';
    if (this.focusAuto) this.focusPos = 0.5;
  }

  /** Respuesta de la cámara: multiplicador por canal y desplazamiento del negro. */
  transfer(): { r: number; g: number; b: number; offset: number } {
    const im = this.settings;
    const shutter = seconds(CAMERA_SHUTTERS[im.shutter] ?? '1/50') / (1 / 50);
    const exposure =
      this.scene.light * 2 ** ((im.iris - 50) / 15) * 10 ** (im.gainDb / 20) * shutter;
    return {
      r: exposure * (1 + this.scene.tintR) * (1 + im.rGain / 100),
      g: exposure,
      b: exposure * (1 + this.scene.tintB) * (1 + im.bGain / 100),
      offset: this.scene.black + im.pedestal / 200,
    };
  }

  async snapshot() {
    this.integrate();
    const t = this.transfer();
    const w = WORLD.w / this.zoom;
    const h = WORLD.h / this.zoom;
    const cx = clamp(WORLD.w / 2 + this.pan * 4, w / 2 - 200, WORLD.w - w / 2 + 200);
    const cy = clamp(WORLD.h / 2 - this.tilt * 4, h / 2 - 120, WORLD.h - h / 2 + 120);
    const blur = this.focusAuto ? 0 : Math.abs(this.focusPos - 0.5) * 12;
    const fn = (slope: number) => `type="linear" slope="${n3(slope)}" intercept="${n3(t.offset)}"`;
    const patches = ['#b8432f', '#d6a52c', '#3f8f3f', '#2f9fb0', '#2c4fa8', '#a33f8f'];
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="${n3(cx - w / 2)} ${n3(cy - h / 2)} ${n3(w)} ${n3(h)}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d7c8c"/><stop offset="1" stop-color="#4b5662"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4636"/><stop offset="1" stop-color="#33281f"/></linearGradient>
<filter id="cam" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
${blur > 0.2 ? `<feGaussianBlur stdDeviation="${n3(blur)}"/>` : ''}
<feComponentTransfer><feFuncR ${fn(t.r)}/><feFuncG ${fn(t.g)}/><feFuncB ${fn(t.b)}/></feComponentTransfer>
</filter>
</defs>
<g filter="url(#cam)">
<rect x="-2000" y="-2000" width="5600" height="4900" fill="#2b3036"/>
<rect x="0" y="0" width="1600" height="620" fill="url(#wall)"/>
<rect x="0" y="620" width="1600" height="280" fill="url(#floor)"/>
<rect x="120" y="90" width="360" height="250" fill="#f2efe4"/>
<rect x="120" y="90" width="360" height="250" fill="none" stroke="#2a2a2a" stroke-width="10"/>
<rect x="1120" y="110" width="360" height="200" fill="#1d2b44"/>
<text x="1300" y="225" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#ff7a1a" text-anchor="middle">RUNFLOW</text>
<rect x="690" y="330" width="220" height="250" rx="60" fill="#1f3a66"/>
<circle cx="800" cy="285" r="70" fill="#d9a27f"/>
<path d="M730 270 Q800 170 870 270 Q860 215 800 205 Q740 215 730 270Z" fill="#3a2a1f"/>
<rect x="420" y="520" width="760" height="150" fill="#22282e"/>
<rect x="420" y="520" width="760" height="14" fill="#c9cdd2"/>
<rect x="560" y="400" width="90" height="90" fill="#7f7f7f"/>
<rect x="660" y="400" width="40" height="90" fill="#ebebeb"/>
<rect x="1040" y="400" width="40" height="90" fill="#141414"/>
${patches.map((c, i) => `<rect x="${1090 + i * 52}" y="560" width="46" height="46" fill="${c}"/>`).join('')}
</g>
</svg>`;
    return { type: 'image/svg+xml', body };
  }

  async probe() {
    return 'Cámara simulada';
  }

  close() {}
}
