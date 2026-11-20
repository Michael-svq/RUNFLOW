import * as Y from 'yjs';
import { getLinesMap, readLines, type CellValue } from './rundown-doc';
import { getScriptFragment, scriptField, SCRIPT_PREFIX } from './script';

/*
 * Copias completas del contenido de una escaleta (líneas + guiones):
 * plantillas, restaurar versiones y nevera.
 */

export function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (state.length) Y.applyUpdate(doc, state);
  return doc;
}

/** Ids de las líneas con guion en el documento. */
function scriptedLineIds(doc: Y.Doc): string[] {
  return [...doc.share.keys()]
    .filter((k) => k.startsWith(SCRIPT_PREFIX))
    .map((k) => k.slice(SCRIPT_PREFIX.length));
}

/**
 * Sustituye el contenido de `target` por el de `source` (mismas líneas, ids,
 * orden, celdas y guiones). Se hace como una transacción normal de Yjs, así
 * que quien esté conectado ve el cambio al instante.
 */
export function replaceContent(
  target: Y.Doc,
  source: Y.Doc,
  opts: { origin?: unknown; clearStatus?: boolean } = {},
): void {
  const sourceLines = readLines(source);
  target.transact(() => {
    const lines = getLinesMap(target);
    for (const id of [...lines.keys()]) lines.delete(id);
    for (const id of scriptedLineIds(target)) {
      const f = getScriptFragment(target, id);
      if (f.length) f.delete(0, f.length);
    }
    for (const l of sourceLines) {
      const line = new Y.Map<unknown>();
      const cells = new Y.Map<CellValue>();
      for (const [k, v] of Object.entries(l.cells)) {
        if (opts.clearStatus && k === 'estado') continue;
        cells.set(k, v);
      }
      line.set('pos', l.pos);
      line.set('cells', cells);
      lines.set(l.id, line);
      if (source.share.has(scriptField(l.id))) {
        const nodes = getScriptFragment(source, l.id)
          .toArray()
          .map((n) => (n as Y.XmlElement | Y.XmlText).clone());
        if (nodes.length) getScriptFragment(target, l.id).insert(0, nodes);
      }
    }
  }, opts.origin);
}

/** Estado compacto (sin historial) de un documento: para plantillas y versiones. */
export function compactState(source: Y.Doc, opts: { clearStatus?: boolean } = {}): Uint8Array {
  const fresh = new Y.Doc();
  replaceContent(fresh, source, opts);
  const state = Y.encodeStateAsUpdate(fresh);
  fresh.destroy();
  return state;
}
