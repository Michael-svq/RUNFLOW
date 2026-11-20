import http from 'node:http';
import { CasparSimulator } from '../cg/simulator';
import { ObsSimulator } from '../mixers/obs';

/*
 * Estudio virtual para probar RunFlow sin equipos: un CasparCG y un OBS
 * simulados (los mismos que usan las pruebas) y un monitor web que enseña
 * el PROGRAMA: la cámara o el VTR que está en el aire y, encima, los rótulos
 * con las plantillas reales de RunFlow CG.
 *
 *   node dist/studio.js
 *
 * Variables: STUDIO_HOST (0.0.0.0), CASPAR_PORT (5250), OBS_PORT (4455),
 * MONITOR_PORT (8090), OSC_HOST / OSC_PORT (a dónde mandar la posición de los
 * vídeos: el servidor de RunFlow, 6250) y RUNFLOW_URL (la dirección de RunFlow
 * vista desde el navegador, para cargar las plantillas).
 */

const env = process.env;
const HOST = env.STUDIO_HOST ?? '0.0.0.0';
const CASPAR_PORT = Number(env.CASPAR_PORT ?? 5250);
const OBS_PORT = Number(env.OBS_PORT ?? 4455);
const MONITOR_PORT = Number(env.MONITOR_PORT ?? 8090);
const RUNFLOW_URL = (env.RUNFLOW_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Vídeos de ejemplo que «tiene» el CasparCG virtual. */
export const DEMO_CLIPS = [
  { name: 'CABECERA', duration: 8 },
  { name: 'PIEZA_PRESUPUESTOS', duration: 20 },
  { name: 'PIEZA_DEPORTES', duration: 15 },
  { name: 'CORTINILLA', duration: 4 },
];

const caspar = new CasparSimulator({
  clips: DEMO_CLIPS,
  oscPort: Number(env.OSC_PORT ?? 6250),
  oscHost: env.OSC_HOST ?? '127.0.0.1',
  version: '2.3.3 LTS (estudio virtual de RunFlow)',
});
const obs = new ObsSimulator({
  scenes: ['CAM 1', 'CAM 2', 'CAM 3', 'VTR'],
  port: OBS_PORT,
  host: HOST,
});

/** Las plantillas se cargan desde la dirección de RunFlow que ve el navegador. */
function templateUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${RUNFLOW_URL}${u.pathname}`;
  } catch {
    return url;
  }
}

function state() {
  const layers = [...caspar.layers.entries()]
    .map(([key, l]) => {
      const [ch, ly] = key.split('-').map(Number) as [number, number];
      const clip = l.clip
        ? DEMO_CLIPS.find((c) => c.name.toLowerCase() === l.clip!.toLowerCase())
        : null;
      return {
        key,
        layer: ly,
        clip: l.playing ? l.clip : null,
        position: caspar.position(ch, ly),
        duration: clip?.duration ?? null,
        template: templateUrl(l.template),
        data: l.templateData,
        visible: l.templateVisible,
      };
    })
    .sort((a, b) => a.layer - b.layer);
  return {
    program: obs.program,
    streaming: obs.streaming,
    recording: obs.recording,
    layers,
    commands: caspar.commands.slice(-8).map((c) => c.command.slice(0, 140)),
    runflowUrl: RUNFLOW_URL,
  };
}

const page = (): string => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estudio virtual · RunFlow</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #12191c; color: #f2f2f2; font: 14px/1.4 system-ui, sans-serif; }
  header { display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: #1f2a2e; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0 auto 0 0; }
  .tally { padding: 2px 10px; border-radius: 4px; background: #333; font-weight: 700; }
  .tally.on { background: #cc4125; }
  main { padding: 16px; display: grid; gap: 16px; grid-template-columns: minmax(0, 3fr) minmax(220px, 1fr); }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .screen { position: relative; aspect-ratio: 16 / 9; background: #000; overflow: hidden; border: 3px solid #cc4125; border-radius: 6px; }
  .label { position: absolute; top: 8px; left: 10px; font-weight: 800; letter-spacing: .1em; font-size: 12px; background: #cc4125; padding: 2px 8px; border-radius: 3px; z-index: 5; }
  .bg { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 900; font-size: 9vw; color: rgba(255,255,255,.18); transition: background .2s; }
  .bg.cam1 { background: radial-gradient(circle at 40% 40%, #3c78d8, #0b1a33); }
  .bg.cam2 { background: radial-gradient(circle at 60% 40%, #2f7d32, #0b2210); }
  .bg.cam3 { background: radial-gradient(circle at 50% 30%, #953734, #2a0d0c); }
  .bg.vtr { background: linear-gradient(120deg, #222 0%, #444 50%, #222 100%); background-size: 200% 200%; animation: vtr 3s linear infinite; }
  @keyframes vtr { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
  .bg .clip { display: block; font-size: 4vw; max-width: 90%; text-align: center; overflow-wrap: anywhere; }
  .bg .sub { display: block; font-size: 2vw; color: rgba(255,255,255,.6); text-align: center; }
  iframe.cg { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; z-index: 3; }
  aside { display: grid; gap: 12px; align-content: start; }
  .card { background: #1f2a2e; border-radius: 6px; padding: 12px; }
  .card h2 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #ffd24a; }
  code, pre { font: 12px/1.35 ui-monospace, monospace; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-all; color: #bbb; }
  a { color: #ff7a1a; }
</style></head>
<body>
<header>
  <h1>Estudio virtual de RunFlow</h1>
  <span class="tally" id="prog">PROGRAMA: —</span>
  <span class="tally" id="rec">REC</span>
  <span class="tally" id="live">EMISIÓN</span>
</header>
<main>
  <div class="screen" id="screen">
    <span class="label">PROGRAMA</span>
    <div class="bg cam1" id="bg">CAM 1</div>
  </div>
  <aside>
    <div class="card">
      <h2>Cómo usarlo</h2>
      <p>Abre <a id="rf" target="_blank" rel="noreferrer" href="#">RunFlow</a>, entra en la escaleta
      <b>Informativo de prueba</b> y pulsa <b>GO</b>: aquí verás el corte de cámara (OBS), los vídeos
      y los rótulos (CasparCG). El teleprompter está en el botón <b>Prompter</b> de la escaleta.</p>
    </div>
    <div class="card"><h2>Capas de CasparCG</h2><pre id="layers">—</pre></div>
    <div class="card"><h2>Últimas órdenes AMCP</h2><pre id="cmds">—</pre></div>
  </aside>
</main>
<script>
const frames = new Map();
const bg = document.getElementById('bg');
function fmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function post(f, cmd, data) { try { f.contentWindow.postMessage({ runflowCg: true, cmd, data }, '*'); } catch (e) {} }
function sync(l) {
  let f = frames.get(l.key);
  if (!l.template) { if (f) { post(f.el, 'stop'); const el = f.el; setTimeout(() => el.remove(), 600); frames.delete(l.key); } return; }
  if (!f || f.src !== l.template) {
    if (f) f.el.remove();
    const el = document.createElement('iframe');
    el.className = 'cg'; el.style.zIndex = String(3 + l.layer);
    el.src = l.template;
    f = { el, src: l.template, data: null, visible: false, ready: false };
    el.addEventListener('load', () => { f.ready = true; f.data = null; f.visible = false; sync(l); });
    document.getElementById('screen').appendChild(el);
    frames.set(l.key, f);
    return;
  }
  if (!f.ready) return;
  if (f.data !== l.data) { post(f.el, 'update', l.data || '{}'); f.data = l.data; }
  if (f.visible !== l.visible) { post(f.el, l.visible ? 'play' : 'stop'); f.visible = l.visible; }
}
async function tick() {
  try {
    const s = await (await fetch('/state', { cache: 'no-store' })).json();
    document.getElementById('rf').href = s.runflowUrl;
    const vtr = s.layers.find((l) => l.clip);
    const prog = s.program || '—';
    document.getElementById('prog').textContent = 'PROGRAMA: ' + prog;
    document.getElementById('prog').classList.add('on');
    document.getElementById('rec').classList.toggle('on', s.recording);
    document.getElementById('live').classList.toggle('on', s.streaming);
    const isVtr = /vtr/i.test(prog);
    bg.className = 'bg ' + (isVtr ? 'vtr' : /3/.test(prog) ? 'cam3' : /2/.test(prog) ? 'cam2' : 'cam1');
    bg.innerHTML = isVtr && vtr
      ? '<span class="clip">▶ ' + vtr.clip + '</span><span class="sub">' + fmt(vtr.position || 0) + ' / ' + fmt(vtr.duration || 0) + '</span>'
      : prog;
    for (const l of s.layers) sync(l);
    for (const key of frames.keys()) if (!s.layers.some((l) => l.key === key)) sync({ key, template: null });
    document.getElementById('layers').textContent = s.layers.length
      ? s.layers.map((l) => l.key + ': ' + (l.clip ? '▶ ' + l.clip : l.template ? (l.visible ? '● ' : '○ ') + l.template.split('/').pop() : '—')).join('\\n')
      : 'Vacío';
    document.getElementById('cmds').textContent = s.commands.join('\\n') || '—';
  } catch (e) {}
  setTimeout(tick, 200);
}
tick();
</script>
</body></html>`;

async function main() {
  await caspar.start(CASPAR_PORT, HOST);
  await obs.start();
  http
    .createServer((req, res) => {
      if (req.url === '/state') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(state()));
      }
      if (req.url === '/health') return res.end('ok');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page());
    })
    .listen(MONITOR_PORT, HOST);
  console.log(
    `Estudio virtual: CasparCG ${HOST}:${CASPAR_PORT} · OBS ${HOST}:${OBS_PORT} · monitor http://localhost:${MONITOR_PORT}`,
  );
}

const stop = () => {
  void caspar.stop();
  void obs.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
void main();
