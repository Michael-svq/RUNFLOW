import * as Y from 'yjs';
import { isCueTrack, type Cue } from '@runflow/core';

/*
 * F4.1 Cues del timeline de cada línea, en el documento colaborativo
 * (`cues:<lineId>`, un Y.Array de Y.Map), para editarlos a la vez.
 */

export const CUES_PREFIX = 'cues:';
export const cuesField = (lineId: string) => `${CUES_PREFIX}${lineId}`;

function cueArray(doc: Y.Doc, lineId: string): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(cuesField(lineId));
}

function toCue(m: Y.Map<unknown>): Cue | null {
  const track = m.get('track');
  const at = Number(m.get('at'));
  if (!isCueTrack(track) || !Number.isFinite(at)) return null;
  return {
    id: String(m.get('id') ?? ''),
    track,
    at: Math.max(0, at),
    duration: Math.max(0, Number(m.get('duration') ?? 0) || 0),
    label: String(m.get('label') ?? ''),
    target: String(m.get('target') ?? ''),
  };
}

/** Cues de una línea ordenados por tiempo. */
export function readCues(doc: Y.Doc, lineId: string): Cue[] {
  if (!doc.share.get(cuesField(lineId))) return [];
  return cueArray(doc, lineId)
    .toArray()
    .flatMap((m) => {
      const c = toCue(m);
      return c ? [c] : [];
    })
    .sort((a, b) => a.at - b.at);
}

/** Cues de varias líneas. */
export function readAllCues(doc: Y.Doc, lineIds: string[]): Map<string, Cue[]> {
  return new Map(lineIds.map((id) => [id, readCues(doc, id)]));
}

export function addCue(
  doc: Y.Doc,
  lineId: string,
  cue: Omit<Cue, 'id'> & { id?: string },
  origin?: unknown,
): string {
  const id = cue.id ?? globalThis.crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('id', id);
    m.set('track', cue.track);
    m.set('at', cue.at);
    m.set('duration', cue.duration);
    m.set('label', cue.label);
    m.set('target', cue.target);
    cueArray(doc, lineId).push([m]);
  }, origin);
  return id;
}

export function updateCue(
  doc: Y.Doc,
  lineId: string,
  id: string,
  patch: Partial<Omit<Cue, 'id'>>,
  origin?: unknown,
): void {
  doc.transact(() => {
    const m = cueArray(doc, lineId)
      .toArray()
      .find((x) => x.get('id') === id);
    if (!m) return;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
  }, origin);
}

export function deleteCue(doc: Y.Doc, lineId: string, id: string, origin?: unknown): void {
  doc.transact(() => {
    const arr = cueArray(doc, lineId);
    const idx = arr.toArray().findIndex((x) => x.get('id') === id);
    if (idx >= 0) arr.delete(idx, 1);
  }, origin);
}

/** Copia los cues (al duplicar una línea), con ids nuevos. */
export function copyCues(doc: Y.Doc, fromLineId: string, toLineId: string, origin?: unknown): void {
  const cues = readCues(doc, fromLineId);
  if (!cues.length) return;
  doc.transact(() => {
    for (const { id: _id, ...c } of cues) addCue(doc, toLineId, c, origin);
  }, origin);
}

/** Vacía los cues de una línea (al borrarla). */
export function clearCues(doc: Y.Doc, lineId: string, origin?: unknown): void {
  if (!doc.share.get(cuesField(lineId))) return;
  const arr = cueArray(doc, lineId);
  if (arr.length) doc.transact(() => arr.delete(0, arr.length), origin);
}
