import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addCue, deleteCue, readCues, updateCue } from './cues';
import { deleteLines, duplicateLine, insertLine } from './rundown-doc';

describe('cues', () => {
  it('se añaden, editan, copian al duplicar y se borran con la línea', () => {
    const doc = new Y.Doc();
    const line = insertLine(doc, { cells: { nombre: 'Canción' } });
    const c2 = addCue(doc, line, {
      track: 'luces',
      at: 12.2,
      duration: 0,
      label: 'LQ 5',
      target: '5',
    });
    addCue(doc, line, { track: 'camara', at: 0, duration: 0, label: 'CAM 1 PG', target: 'CAM 1' });
    expect(readCues(doc, line).map((c) => c.label)).toEqual(['CAM 1 PG', 'LQ 5']);

    updateCue(doc, line, c2, { at: 14, label: 'LQ 6' });
    expect(readCues(doc, line)[1]).toMatchObject({ at: 14, label: 'LQ 6', track: 'luces' });

    const copy = duplicateLine(doc, line)!;
    const copied = readCues(doc, copy);
    expect(copied).toHaveLength(2);
    expect(copied[1]!.id).not.toBe(c2);

    deleteCue(doc, line, c2);
    expect(readCues(doc, line)).toHaveLength(1);
    deleteLines(doc, [line]);
    expect(readCues(doc, line)).toHaveLength(0);
  });

  it('convergen entre dos documentos', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const line = insertLine(a);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    addCue(a, line, { track: 'camara', at: 1, duration: 0, label: 'A', target: '' });
    addCue(b, line, { track: 'letras', at: 2, duration: 4, label: 'B', target: '' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    expect(readCues(a, line)).toEqual(readCues(b, line));
    expect(readCues(a, line)).toHaveLength(2);
  });
});
