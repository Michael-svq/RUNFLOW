// Genera los iconos de la PWA a partir del logo vectorial (letra R + barra naranja).
// Uso: pnpm --filter @runflow/web icons
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const logo = readFileSync(
  path.resolve(here, '../../../packages/ui/src/assets/runflow-logo.svg'),
  'utf8',
);
const full = logo.match(/<path d="([^"]+)"/)[1];
// El primer subtrazado del logotipo es la letra R.
const d = full.slice(0, full.indexOf('Z') + 1);
const out = path.resolve(here, '../public');

const BG = '#1F2A2E';
const ORANGE = '#FF7A1A';
const WHITE = '#FAFAFA';

/** Icono cuadrado: la "R" del logotipo (recortada) y la barra naranja de la marca. */
function iconSvg({ padding }) {
  // Caja de la R en el viewBox original del logotipo (5274×844).
  const glyph = { x: 100.3, y: 64.4, w: 721.5, h: 752.7 };
  const size = 1000;
  const inner = size * (1 - 2 * padding);
  const BAR = 0.34; // ancho de la barra respecto a la letra
  const GAP = 0.06;
  const scale = Math.min((inner * 0.8) / glyph.h, (inner * 0.92) / (glyph.w * (1 + BAR + GAP)));
  const gw = glyph.w * scale;
  const gh = glyph.h * scale;
  const barW = gw * BAR;
  const barH = gh * 0.11;
  const totalW = barW + gw * GAP + gw;
  const left = (size - totalW) / 2;
  const top = (size - gh) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <rect x="${left}" y="${top + gh - barH}" width="${barW}" height="${barH}" fill="${ORANGE}"/>
  <svg x="${left + barW + gw * GAP}" y="${top}" width="${gw}" height="${gh}" viewBox="${glyph.x} ${glyph.y} ${glyph.w} ${glyph.h}">
    <path d="${d}" fill="${WHITE}" fill-rule="evenodd"/>
  </svg>
</svg>`;
}

const favicon = iconSvg({ padding: 0.04 }).replace(
  `<rect width="1000" height="1000" fill="${BG}"/>`,
  `<rect width="1000" height="1000" rx="180" fill="${BG}"/>`,
);
writeFileSync(path.join(out, 'favicon.svg'), favicon);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg, px, file) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${px}" height="${px}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(out, file), omitBackground: false });
}
await png(iconSvg({ padding: 0.08 }), 192, 'pwa-192.png');
await png(iconSvg({ padding: 0.08 }), 512, 'pwa-512.png');
await png(iconSvg({ padding: 0.2 }), 512, 'pwa-maskable-512.png');
await png(iconSvg({ padding: 0.1 }), 180, 'apple-touch-icon.png');
await browser.close();
console.log('Iconos generados en', out);
