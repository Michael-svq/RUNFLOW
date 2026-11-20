import * as Y from 'yjs';

/*
 * Guion de cada línea (PLAN §12): un fragmento XML de Yjs por línea, el mismo
 * que edita TipTap/ProseMirror en la web.
 *
 *   paragraph[kind=paso|off|nota]  texto (sin kind = paso)
 *   rotulo[type, f0..f3, tcIn, tcOut, id]  (bloque estructurado, sin texto)
 *
 * El color es presentación: lo que importa es el tipo de cada bloque.
 */

export type ScriptKind = 'paso' | 'off' | 'nota';

export interface ScriptTextBlock {
  kind: ScriptKind;
  text: string;
}

export interface ScriptGraphicBlock {
  kind: 'rotulo';
  id: string;
  type: string;
  f0: string;
  f1: string;
  f2: string;
  f3: string;
  tcIn: string;
  tcOut: string;
}

export type ScriptBlock = ScriptTextBlock | ScriptGraphicBlock;

export const SCRIPT_PREFIX = 'script:';

export function scriptField(lineId: string): string {
  return `${SCRIPT_PREFIX}${lineId}`;
}

export function getScriptFragment(doc: Y.Doc, lineId: string): Y.XmlFragment {
  return doc.getXmlFragment(scriptField(lineId));
}

function textOf(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as { insert: unknown }[])
      .map((d) => (typeof d.insert === 'string' ? d.insert : ''))
      .join('');
  }
  if (node instanceof Y.XmlElement) {
    if (node.nodeName === 'hardBreak') return '\n';
    return node
      .toArray()
      .map((c) => textOf(c as Y.XmlElement | Y.XmlText))
      .join('');
  }
  return '';
}

const attr = (el: Y.XmlElement, name: string): string => {
  const v = el.getAttribute(name) as unknown;
  return v === undefined || v === null ? '' : String(v);
};

export function readScript(fragment: Y.XmlFragment): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  for (const node of fragment.toArray()) {
    if (!(node instanceof Y.XmlElement)) continue;
    if (node.nodeName === 'rotulo') {
      blocks.push({
        kind: 'rotulo',
        id: attr(node, 'id'),
        type: attr(node, 'type'),
        f0: attr(node, 'f0'),
        f1: attr(node, 'f1'),
        f2: attr(node, 'f2'),
        f3: attr(node, 'f3'),
        tcIn: attr(node, 'tcIn'),
        tcOut: attr(node, 'tcOut'),
      });
    } else if (node.nodeName === 'paragraph') {
      const kind = attr(node, 'kind');
      blocks.push({
        // Sin tipo = paso (el tipo por defecto del editor).
        kind: kind === 'off' || kind === 'nota' ? kind : 'paso',
        text: textOf(node),
      });
    }
  }
  return blocks;
}

export function countWords(text: string): number {
  const words = text.trim().match(/[\p{L}\p{N}](?:[\p{L}\p{N}'’.,-]*[\p{L}\p{N}])?/gu);
  return words ? words.length : 0;
}

export interface ScriptSummary {
  /** Texto del paso (lo que lee el presentador), por párrafos. */
  paso: string[];
  off: string[];
  pasoWords: number;
  offWords: number;
  /** Segundos de lectura del paso según la velocidad de lectura. */
  readingSeconds: number;
  graphics: ScriptGraphicBlock[];
  empty: boolean;
}

export function summarizeScript(blocks: ScriptBlock[], wordsPerSecond = 3): ScriptSummary {
  const paso: string[] = [];
  const off: string[] = [];
  const graphics: ScriptGraphicBlock[] = [];
  for (const b of blocks) {
    if (b.kind === 'rotulo') graphics.push(b);
    else if (b.kind === 'paso' && b.text.trim()) paso.push(b.text);
    else if (b.kind === 'off' && b.text.trim()) off.push(b.text);
  }
  const pasoWords = paso.reduce((s, t) => s + countWords(t), 0);
  const offWords = off.reduce((s, t) => s + countWords(t), 0);
  return {
    paso,
    off,
    pasoWords,
    offWords,
    readingSeconds: Math.round(pasoWords / wordsPerSecond),
    graphics,
    empty: blocks.every((b) => b.kind !== 'rotulo' && !b.text.trim()),
  };
}

/** Resumen del guion de una línea (vacío si no tiene). */
export function lineScript(doc: Y.Doc, lineId: string, wordsPerSecond = 3): ScriptSummary {
  const share = doc.share.get(scriptField(lineId));
  if (!share) return summarizeScript([], wordsPerSecond);
  return summarizeScript(readScript(getScriptFragment(doc, lineId)), wordsPerSecond);
}

/** Copia el guion de una línea a otra (al duplicar). */
export function copyScript(
  doc: Y.Doc,
  fromLineId: string,
  toLineId: string,
  origin?: unknown,
): void {
  if (!doc.share.get(scriptField(fromLineId))) return;
  const from = getScriptFragment(doc, fromLineId);
  const nodes = from.toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone());
  if (!nodes.length) return;
  doc.transact(() => {
    const to = getScriptFragment(doc, toLineId);
    to.delete(0, to.length);
    // Los rótulos copiados reciben un id nuevo.
    for (const n of nodes) {
      if (n instanceof Y.XmlElement && n.nodeName === 'rotulo') {
        n.setAttribute('id', globalThis.crypto.randomUUID());
      }
    }
    to.insert(0, nodes);
  }, origin);
}

/** Vacía el guion de una línea (al borrarla; el fragmento raíz no se puede eliminar). */
export function clearScript(doc: Y.Doc, lineId: string, origin?: unknown): void {
  if (!doc.share.get(scriptField(lineId))) return;
  const fragment = getScriptFragment(doc, lineId);
  if (fragment.length) doc.transact(() => fragment.delete(0, fragment.length), origin);
}

/** Construye un guion (pruebas, importación y plantillas). */
export function writeScript(
  doc: Y.Doc,
  lineId: string,
  blocks: ScriptBlock[],
  origin?: unknown,
): void {
  doc.transact(() => {
    const fragment = getScriptFragment(doc, lineId);
    fragment.delete(0, fragment.length);
    fragment.insert(
      0,
      blocks.map((b) => {
        if (b.kind === 'rotulo') {
          const el = new Y.XmlElement('rotulo');
          for (const k of ['id', 'type', 'f0', 'f1', 'f2', 'f3', 'tcIn', 'tcOut'] as const) {
            if (b[k]) el.setAttribute(k, b[k]);
          }
          return el;
        }
        const p = new Y.XmlElement('paragraph');
        p.setAttribute('kind', b.kind);
        if (b.text) p.insert(0, [new Y.XmlText(b.text)]);
        return p;
      }),
    );
  }, origin);
}
