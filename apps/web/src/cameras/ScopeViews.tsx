import { useEffect, useRef } from 'react';
import { VECTOR_TARGETS, vectorPoint, type Scopes } from './scopes';

/* Dibujo de los monitores de señal: histograma, forma de onda, vectorscopio y RGB. */

const W = 256;
const H = 160;

function useCanvas(draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number, horizontal: boolean) {
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    if (horizontal) {
      const y = Math.round((h * i) / 10) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    } else {
      const x = Math.round((w * i) / 10) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
  }
  ctx.stroke();
}

export function Histogram({ scopes }: { scopes: Scopes | null }) {
  const ref = useCanvas(
    (ctx) => {
      ctx.fillStyle = '#0b0d0e';
      ctx.fillRect(0, 0, W, H);
      grid(ctx, W, H, false);
      if (!scopes) return;
      const max = Math.max(1, ...scopes.histY.slice(2, 254), ...scopes.histR.slice(2, 254));
      const curve = (hist: Uint32Array, color: string, fill: boolean) => {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i < 256; i++) ctx.lineTo(i, H - Math.min(1, hist[i]! / max) * (H - 4));
        ctx.lineTo(255, H);
        if (fill) {
          ctx.fillStyle = color;
          ctx.fill();
        } else {
          ctx.strokeStyle = color;
          ctx.stroke();
        }
      };
      ctx.globalCompositeOperation = 'lighter';
      curve(scopes.histY, 'rgba(220,220,220,0.35)', true);
      curve(scopes.histR, 'rgba(255,70,70,0.9)', false);
      curve(scopes.histG, 'rgba(70,255,90,0.9)', false);
      curve(scopes.histB, 'rgba(80,140,255,0.9)', false);
      ctx.globalCompositeOperation = 'source-over';
    },
    [scopes],
  );
  return <canvas ref={ref} width={W} height={H} aria-label="Histograma" role="img" />;
}

/** Mapa de intensidad de una forma de onda (columnas × 256 niveles). */
function drawWave(
  ctx: CanvasRenderingContext2D,
  wave: Uint32Array,
  cols: number,
  rows: number,
  x0: number,
  w: number,
  color: [number, number, number],
) {
  const img = ctx.getImageData(x0, 0, w, H);
  const gainK = 255 / Math.max(1, rows * 0.15);
  for (let x = 0; x < w; x++) {
    const col = Math.min(cols - 1, Math.floor((x / w) * cols));
    for (let level = 0; level < 256; level++) {
      const v = wave[col * 256 + level]!;
      if (!v) continue;
      const y = H - 1 - Math.floor((level / 255) * (H - 1));
      const i = (y * w + x) * 4;
      const a = Math.min(255, v * gainK + 60);
      img.data[i] = Math.min(255, img.data[i]! + (color[0] * a) / 255);
      img.data[i + 1] = Math.min(255, img.data[i + 1]! + (color[1] * a) / 255);
      img.data[i + 2] = Math.min(255, img.data[i + 2]! + (color[2] * a) / 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, 0);
}

export function Waveform({ scopes }: { scopes: Scopes | null }) {
  const ref = useCanvas(
    (ctx) => {
      ctx.fillStyle = '#0b0d0e';
      ctx.fillRect(0, 0, W, H);
      if (scopes) drawWave(ctx, scopes.waveY, scopes.width, scopes.height, 0, W, [120, 255, 140]);
      grid(ctx, W, H, true);
    },
    [scopes],
  );
  return <canvas ref={ref} width={W} height={H} aria-label="Forma de onda" role="img" />;
}

export function Parade({ scopes }: { scopes: Scopes | null }) {
  const ref = useCanvas(
    (ctx) => {
      ctx.fillStyle = '#0b0d0e';
      ctx.fillRect(0, 0, W, H);
      if (scopes) {
        const third = Math.floor(W / 3);
        drawWave(ctx, scopes.waveR, scopes.width, scopes.height, 0, third, [255, 60, 60]);
        drawWave(ctx, scopes.waveG, scopes.width, scopes.height, third, third, [60, 255, 80]);
        drawWave(ctx, scopes.waveB, scopes.width, scopes.height, third * 2, third, [80, 140, 255]);
      }
      grid(ctx, W, H, true);
    },
    [scopes],
  );
  return <canvas ref={ref} width={W} height={H} aria-label="Desfile RGB" role="img" />;
}

export function Vectorscope({ scopes }: { scopes: Scopes | null }) {
  const S = H;
  const ref = useCanvas(
    (ctx) => {
      ctx.fillStyle = '#0b0d0e';
      ctx.fillRect(0, 0, S, S);
      const c = S / 2;
      const scale = S / 256;
      if (scopes) {
        const img = ctx.getImageData(0, 0, S, S);
        const total = scopes.width * scopes.height;
        const k = 255 / Math.max(1, total * 0.002);
        for (let cr = 0; cr < 256; cr++) {
          for (let cb = 0; cb < 256; cb++) {
            const v = scopes.vector[cr * 256 + cb]!;
            if (!v) continue;
            const x = Math.floor(cb * scale);
            const y = S - 1 - Math.floor(cr * scale);
            const i = (y * S + x) * 4;
            const a = Math.min(255, v * k + 70);
            img.data[i] = Math.max(img.data[i]!, a * 0.55);
            img.data[i + 1] = Math.max(img.data[i + 1]!, a);
            img.data[i + 2] = Math.max(img.data[i + 2]!, a * 0.6);
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.moveTo(c, 2);
      ctx.lineTo(c, S - 2);
      ctx.moveTo(2, c);
      ctx.lineTo(S - 2, c);
      ctx.stroke();
      // Línea de tonos de piel.
      ctx.strokeStyle = 'rgba(255,180,120,0.35)';
      ctx.beginPath();
      ctx.moveTo(c, c);
      const skin = vectorPoint(200, 150, 120);
      ctx.lineTo(c + (skin.x - 128) * scale * 6, c - (skin.y - 128) * scale * 6);
      ctx.stroke();
      ctx.font = '9px sans-serif';
      for (const t of VECTOR_TARGETS) {
        const p = vectorPoint(...t.rgb);
        const x = p.x * scale;
        const y = S - p.y * scale;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.strokeRect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(t.label, x + 6, y + 3);
      }
    },
    [scopes],
  );
  return <canvas ref={ref} width={S} height={S} aria-label="Vectorscopio" role="img" />;
}
