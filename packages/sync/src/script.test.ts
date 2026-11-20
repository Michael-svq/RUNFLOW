import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteLines, duplicateLine, insertLine } from './rundown-doc';
import {
  appendBlocks,
  countWords,
  getScriptFragment,
  lineScript,
  readScript,
  writeScript,
} from './script';

describe('guion', () => {
  it('separa paso, off, notas y rótulos, y calcula la lectura', () => {
    const doc = new Y.Doc();
    const id = insertLine(doc, { cells: { nombre: 'Gobierno' } });
    writeScript(doc, id, [
      { kind: 'paso', text: 'Buenas tardes. El Gobierno aprueba hoy los presupuestos.' },
      { kind: 'off', text: 'El Consejo de Ministros se ha reunido esta mañana.' },
      { kind: 'nota', text: 'Ojo: confirmar cifras' },
      {
        kind: 'rotulo',
        id: 'r1',
        type: 'TOT',
        f0: 'ANA PÉREZ',
        f1: 'MINISTRA',
        f2: '',
        f3: '',
        tcIn: '00:12',
        tcOut: '00:18',
      },
      { kind: 'paso', text: 'Seguimos con más noticias.' },
    ]);
    const s = lineScript(doc, id);
    expect(s.paso).toEqual([
      'Buenas tardes. El Gobierno aprueba hoy los presupuestos.',
      'Seguimos con más noticias.',
    ]);
    expect(s.off).toHaveLength(1);
    expect(s.pasoWords).toBe(12);
    expect(s.readingSeconds).toBe(4);
    expect(s.graphics).toEqual([
      expect.objectContaining({
        type: 'TOT',
        f0: 'ANA PÉREZ',
        f1: 'MINISTRA',
        tcIn: '00:12',
        tcOut: '00:18',
      }),
    ]);
  });

  it('cuenta palabras con acentos, números y apóstrofos', () => {
    expect(countWords('  Á Ñandú 3,5 l’hôtel  ')).toBe(4);
    expect(countWords('')).toBe(0);
  });

  it('una línea sin guion devuelve un resumen vacío', () => {
    const doc = new Y.Doc();
    const id = insertLine(doc, {});
    expect(lineScript(doc, id)).toMatchObject({ paso: [], graphics: [], empty: true });
  });

  it('al duplicar se copia el guion con rótulos de id nuevo; al borrar se vacía', () => {
    const doc = new Y.Doc();
    const id = insertLine(doc, { cells: { nombre: 'A' } });
    writeScript(doc, id, [
      { kind: 'paso', text: 'Hola' },
      {
        kind: 'rotulo',
        id: 'r1',
        type: 'LOC',
        f0: 'SEVILLA',
        f1: '',
        f2: '',
        f3: '',
        tcIn: '',
        tcOut: '',
      },
    ]);
    const copy = duplicateLine(doc, id)!;
    const copied = readScript(getScriptFragment(doc, copy));
    expect(copied[0]).toEqual({ kind: 'paso', text: 'Hola' });
    expect(copied[1]).toMatchObject({ kind: 'rotulo', type: 'LOC', f0: 'SEVILLA' });
    expect((copied[1] as { id: string }).id).not.toBe('r1');
    deleteLines(doc, [id]);
    expect(getScriptFragment(doc, id).length).toBe(0);
    expect(lineScript(doc, copy).paso).toEqual(['Hola']);
  });

  it('ediciones simultáneas del guion se combinan', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const id = insertLine(a, {});
    writeScript(a, id, [{ kind: 'paso', text: 'Uno' }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const pa = getScriptFragment(a, id).get(0) as Y.XmlElement;
    const pb = getScriptFragment(b, id).get(0) as Y.XmlElement;
    (pa.get(0) as Y.XmlText).insert(3, ' dos');
    (pb.get(0) as Y.XmlText).insert(0, 'Cero ');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    expect(lineScript(a, id).paso).toEqual(['Cero Uno dos']);
    expect(lineScript(b, id).paso).toEqual(['Cero Uno dos']);
  });

  it('añade bloques al final sin tocar el guion', () => {
    const doc = new Y.Doc();
    const id = insertLine(doc);
    writeScript(doc, id, [{ kind: 'paso', text: 'Hola.' }]);
    appendBlocks(doc, id, [
      {
        kind: 'rotulo',
        id: 'g1',
        type: 'RRS',
        f0: 'Lucía',
        f1: '@lucia',
        f2: 'Gran gala',
        f3: 'Bluesky',
        tcIn: '',
        tcOut: '',
      },
    ]);
    const blocks = readScript(getScriptFragment(doc, id));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: 'paso', text: 'Hola.' });
    expect(blocks[1]).toMatchObject({ kind: 'rotulo', type: 'RRS', f2: 'Gran gala' });
  });
});
