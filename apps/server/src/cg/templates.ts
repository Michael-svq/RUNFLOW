import { GRAPHIC_TYPE_BY_KEY } from '@runflow/core';

/*
 * Plantillas HTML de RunFlow CG (PLAN §15). CasparCG 2.3+ las ejecuta con
 * `CG ADD … "http://…/cg/templates/TOT.html" 1 "<json>"`, que llama a
 * update(datos) y play(); stop() anima la salida. La web usa las mismas
 * páginas en la vista previa (postMessage), así que lo que se ve es lo que sale.
 *
 * Los datos (CgTemplateData de @runflow/core) llevan los textos y el diseño
 * de la empresa: la plantilla no guarda nada.
 */

const CSS = `
@font-face { font-family: 'Montserrat'; font-weight: 700; src: url('/cg/fonts/montserrat-700.woff2') format('woff2'); }
@font-face { font-family: 'Montserrat'; font-weight: 900; src: url('/cg/fonts/montserrat-900.woff2') format('woff2'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
body {
  --primary: #FF7A1A; --secondary: #1F2A2E; --text: #FFFFFF; --accent-text: #1F2A2E;
  --font: 'Montserrat'; --bottom: 9vh; --margin: 6vw; --ms: 450ms;
  font-family: var(--font), 'Helvetica Neue', Helvetica, Arial, sans-serif;
  color: var(--text);
}
body.preview { background: repeating-conic-gradient(#2a3438 0% 25%, #222b2f 0% 50%) 50% / 40px 40px; }
#g { position: absolute; inset: 0; pointer-events: none; }
.box { position: absolute; display: flex; flex-direction: column; max-width: calc(100vw - 2 * var(--margin)); }
.l1, .l2, .tag { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.l1 { font-weight: 900; line-height: 1.15; }
.l2 { font-weight: 700; line-height: 1.2; }

/* Animaciones: entrada con .in, salida con .out */
.anim { transition: transform var(--ms) cubic-bezier(.2,.8,.2,1), opacity var(--ms) ease, clip-path var(--ms) ease; }
.slide .anim { transform: translateX(-6vw); opacity: 0; }
.slide.align-right .anim { transform: translateX(6vw); }
.slide.align-center .anim { transform: translateY(4vh); }
.fade .anim { opacity: 0; }
.wipe .anim { clip-path: inset(0 100% 0 0); }
.in .anim { transform: none; opacity: 1; clip-path: inset(0 0 0 0); }
.out .anim { opacity: 0; }
.in .anim.d1 { transition-delay: calc(var(--ms) * .25); }

/* Inferiores: TOT e INF */
.lower { bottom: var(--bottom); }
.align-left .lower { left: var(--margin); align-items: flex-start; }
.align-right .lower { right: var(--margin); align-items: flex-end; }
.align-center .lower { left: 50%; transform: translateX(-50%); align-items: center; }
.lower .l1 { background: var(--secondary); color: var(--text); font-size: 4.4vh; padding: 1.1vh 2.2vw 0.9vh; border-left: 0.9vh solid var(--primary); }
.lower .l2 { background: var(--primary); color: var(--accent-text); font-size: 2.8vh; padding: 0.7vh 2.2vw; margin-left: 0.9vh; }
.lower .tag { background: var(--primary); color: var(--accent-text); font-weight: 900; font-size: 2.1vh; letter-spacing: .12em; padding: .45vh 1.2vw; margin-bottom: .6vh; }

/* Localizador */
.loc { top: 7vh; left: var(--margin); flex-direction: row; align-items: stretch; }
.align-right .loc { left: auto; right: var(--margin); }
.loc .pin { width: 1vh; background: var(--primary); }
.loc .l1 { background: var(--secondary); font-size: 3vh; padding: .9vh 1.6vw; }

/* Fecha y mosca */
.dat { top: 6vh; right: var(--margin); align-items: flex-end; }
.dat .tag { background: var(--primary); color: var(--accent-text); font-weight: 900; font-size: 2.6vh; padding: .6vh 1.2vw; }
.dat .l2 { background: var(--secondary); font-size: 2.4vh; padding: .6vh 1.2vw; }

/* Banner: franja inferior de dos líneas */
.ban { left: 0; right: 0; bottom: var(--bottom); max-width: none; }
.ban .l1 { background: var(--primary); color: var(--accent-text); font-size: 4vh; padding: 1vh var(--margin); }
.ban .l2 { background: var(--secondary); font-size: 3vh; padding: .8vh var(--margin); }

/* Destacado */
.hig { bottom: calc(var(--bottom) + 16vh); left: var(--margin); }
.align-right .hig { left: auto; right: var(--margin); align-items: flex-end; }
.align-center .hig { left: 50%; transform: translateX(-50%); align-items: center; }
.hig .l1 { background: var(--text); color: var(--secondary); font-size: 5vh; padding: 1vh 2vw; box-shadow: 1vh 1vh 0 var(--primary); }
.hig .l2 { color: var(--text); font-size: 3.2vh; padding: 1.2vh 2vw 0; text-shadow: 0 .3vh .8vh rgba(0,0,0,.6); }

/* Redes sociales: tarjeta con autor, usuario, texto y red */
.rrs { bottom: var(--bottom); left: var(--margin); width: 46vw; background: var(--secondary); border-left: .9vh solid var(--primary); padding: 1.6vh 1.8vw; }
.align-right .rrs { left: auto; right: var(--margin); }
.align-center .rrs { left: 50%; transform: translateX(-50%); }
.rrs .head { display: flex; align-items: baseline; gap: 1vw; min-width: 0; }
.rrs .l1 { font-size: 3vh; }
.rrs .l2 { font-size: 2.3vh; color: var(--primary); }
.rrs .net { margin-left: auto; background: var(--primary); color: var(--accent-text); font-weight: 900; font-size: 1.8vh; letter-spacing: .1em; padding: .3vh .8vw; text-transform: uppercase; white-space: nowrap; }
.rrs .txt { font-size: 2.8vh; font-weight: 500; line-height: 1.3; margin-top: 1vh; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
`;

const LAYOUTS: Record<string, string> = {
  TOT: `<div class="box lower"><div class="l1 anim" data-f="f0"></div><div class="l2 anim d1" data-f="f1"></div></div>`,
  INF: `<div class="box lower"><div class="tag anim">INFORMA</div><div class="l1 anim" data-f="f0"></div><div class="l2 anim d1" data-f="f1"></div></div>`,
  LOC: `<div class="box loc"><div class="pin anim"></div><div class="l1 anim" data-f="f0"></div></div>`,
  DAT: `<div class="box dat"><div class="tag anim" data-bug></div><div class="l2 anim d1" data-f="f0"></div></div>`,
  BAN: `<div class="box ban"><div class="l1 anim" data-f="f0"></div><div class="l2 anim d1" data-f="f1"></div></div>`,
  HIG: `<div class="box hig"><div class="l1 anim" data-f="f0"></div><div class="l2 anim d1" data-f="f1"></div></div>`,
  RRS: `<div class="box rrs anim"><div class="head"><div class="l1" data-f="f0"></div><div class="l2" data-f="f1"></div><div class="net" data-f="f3"></div></div><div class="txt d1" data-f="f2"></div></div>`,
};

const SCRIPT = `
(function () {
  var g = document.getElementById('g');
  var data = null;
  function parse(input) {
    if (input && typeof input === 'object') return input;
    var s = String(input || '').trim();
    if (!s) return {};
    if (s.charAt(0) === '{') { try { return JSON.parse(s); } catch (e) { return {}; } }
    // Datos en XML (otros clientes de CasparCG): <componentData id="f0"><data value="…"/>
    var out = { fields: {} };
    try {
      var doc = new DOMParser().parseFromString(s, 'text/xml');
      var items = doc.getElementsByTagName('componentData');
      for (var i = 0; i < items.length; i++) {
        var d = items[i].getElementsByTagName('data')[0];
        out.fields[items[i].getAttribute('id')] = d ? d.getAttribute('value') : '';
      }
    } catch (e) {}
    return out;
  }
  function render() {
    var d = data || {};
    var design = d.design || {};
    var st = document.body.style;
    if (design.primary) st.setProperty('--primary', design.primary);
    if (design.secondary) st.setProperty('--secondary', design.secondary);
    if (design.text) st.setProperty('--text', design.text);
    if (design.accentText) st.setProperty('--accent-text', design.accentText);
    if (design.font) st.setProperty('--font', "'" + design.font + "'");
    if (design.bottom != null) st.setProperty('--bottom', design.bottom + 'vh');
    if (design.margin != null) st.setProperty('--margin', design.margin + 'vw');
    if (design.animationMs != null) st.setProperty('--ms', design.animationMs + 'ms');
    g.className = (design.animation || 'slide') + ' align-' + (design.align || 'left') +
      (g.classList.contains('in') ? ' in' : '');
    var fields = d.fields || {};
    var nodes = g.querySelectorAll('[data-f]');
    for (var i = 0; i < nodes.length; i++) {
      var v = fields[nodes[i].getAttribute('data-f')] || '';
      nodes[i].textContent = v;
      nodes[i].style.display = v ? '' : 'none';
    }
    var bug = g.querySelector('[data-bug]');
    if (bug) { bug.textContent = design.bug || ''; bug.style.display = design.bug ? '' : 'none'; }
  }
  window.update = function (input) { data = parse(input); render(); };
  window.play = function () {
    g.classList.remove('out');
    void g.offsetWidth;
    g.classList.add('in');
  };
  window.stop = function () { g.classList.remove('in'); g.classList.add('out'); };
  window.next = function () {};
  window.remove = function () { g.innerHTML = ''; };
  // Vista previa en la web (iframe)
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || !m.runflowCg) return;
    if (m.cmd === 'update') window.update(m.data);
    else if (m.cmd === 'play') window.play();
    else if (m.cmd === 'stop') window.stop();
  });
  var q = new URLSearchParams(location.search);
  if (q.get('preview')) document.body.classList.add('preview');
  if (q.get('data')) { window.update(q.get('data')); window.play(); }
  render();
})();
`;

export const TEMPLATE_TYPES = Object.keys(LAYOUTS);

/** Página HTML de la plantilla de un tipo de rótulo. */
export function templateHtml(type: string): string | null {
  const layout = LAYOUTS[type];
  if (!layout) return null;
  const name = GRAPHIC_TYPE_BY_KEY[type]?.name ?? type;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>RunFlow CG · ${type} ${name}</title>
<meta name="viewport" content="width=1920, height=1080">
<style>${CSS}</style>
</head>
<body>
<div id="g" class="slide align-left">${layout}</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
