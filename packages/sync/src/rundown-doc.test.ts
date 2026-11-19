import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  deleteLines,
  duplicateLine,
  insertLine,
  moveLine,
  numberBetween,
  readLines,
  renumber,
  setCell,
  summarize,
} from './rundown-doc';

/** Sincroniza dos documentos en ambos sentidos (como haría el servidor). */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const names = (doc: Y.Doc) => readLines(doc).map((l) => l.cells.nombre);

describe('numeración', () => {
  it.each([
    [undefined, undefined, '2'],
    ['2', undefined, '4'],
    ['2', '6', '4'],
    ['2', '4', '3'],
    ['2', '3', '2A'],
    ['2A', '3', '2B'],
    [undefined, '6', '4'],
    [undefined, '1', '0'],
  ])('entre %s y %s → %s', (prev, next, expected) => {
    expect(numberBetween(prev, next)).toBe(expected);
  });
});

describe('operaciones', () => {
  it('añade líneas numeradas de 2 en 2 e intercala sin renumerar', () => {
    const doc = new Y.Doc();
    insertLine(doc, { cells: { nombre: 'A' } });
    insertLine(doc, { cells: { nombre: 'B' } });
    insertLine(doc, { cells: { nombre: 'C' } });
    insertLine(doc, { index: 1, cells: { nombre: 'A2' } });
    const lines = readLines(doc);
    expect(lines.map((l) => [l.cells.nombre, l.cells.num])).toEqual([
      ['A', '2'],
      ['A2', '3'],
      ['B', '4'],
      ['C', '6'],
    ]);
    renumber(doc);
    expect(readLines(doc).map((l) => l.cells.num)).toEqual(['2', '4', '6', '8']);
  });

  it('mueve, duplica, edita y borra', () => {
    const doc = new Y.Doc();
    const a = insertLine(doc, { cells: { nombre: 'A', t_est: 30, estado: 'A' } });
    insertLine(doc, { cells: { nombre: 'B', t_est: 45 } });
    insertLine(doc, { cells: { nombre: 'C' } });
    moveLine(doc, a, 2);
    expect(names(doc)).toEqual(['B', 'C', 'A']);
    moveLine(doc, a, 0);
    expect(names(doc)).toEqual(['A', 'B', 'C']);
    const copy = duplicateLine(doc, a)!;
    const copied = readLines(doc).find((l) => l.id === copy)!;
    expect(copied.cells).toMatchObject({ nombre: 'A', t_est: 30 });
    expect(copied.cells.estado).toBeUndefined();
    setCell(doc, copy, 'nombre', 'A bis');
    setCell(doc, copy, 't_est', null);
    expect(names(doc)).toEqual(['A', 'A bis', 'B', 'C']);
    expect(summarize(readLines(doc))).toEqual({ lineCount: 4, estimatedSeconds: 75 });
    deleteLines(doc, [a, copy]);
    expect(names(doc)).toEqual(['B', 'C']);
  });
});

describe('edición simultánea (CRDT)', () => {
  it('ediciones de distintas celdas de la misma línea se combinan', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const id = insertLine(a, { cells: { nombre: 'Gobierno' } });
    sync(a, b);
    setCell(a, id, 'presenta', 'EDU');
    setCell(b, id, 't_est', 240);
    sync(a, b);
    expect(readLines(a)).toEqual(readLines(b));
    expect(readLines(a)[0]!.cells).toMatchObject({
      nombre: 'Gobierno',
      presenta: 'EDU',
      t_est: 240,
    });
  });

  it('dos personas moviendo la misma línea no la duplican', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const x = insertLine(a, { cells: { nombre: 'X' } });
    insertLine(a, { cells: { nombre: 'Y' } });
    insertLine(a, { cells: { nombre: 'Z' } });
    sync(a, b);
    moveLine(a, x, 2);
    moveLine(b, x, 1);
    sync(a, b);
    expect(names(a)).toEqual(names(b));
    expect(names(a).filter((n) => n === 'X')).toHaveLength(1);
    expect(readLines(a)).toHaveLength(3);
  });

  it('inserciones simultáneas en el mismo hueco se conservan y se ordenan igual', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    insertLine(a, { cells: { nombre: 'Inicio' } });
    insertLine(a, { cells: { nombre: 'Fin' } });
    sync(a, b);
    insertLine(a, { index: 1, cells: { nombre: 'De A' } });
    insertLine(b, { index: 1, cells: { nombre: 'De B' } });
    sync(a, b);
    expect(names(a)).toEqual(names(b));
    expect(names(a)[0]).toBe('Inicio');
    expect(names(a)[3]).toBe('Fin');
    expect(new Set(names(a).slice(1, 3))).toEqual(new Set(['De A', 'De B']));

    // Y se puede seguir intercalando entre las dos líneas empatadas.
    insertLine(a, { index: 2, cells: { nombre: 'En medio' } });
    sync(a, b);
    expect(names(a)).toEqual(names(b));
    expect(names(a)[2]).toBe('En medio');
    expect(names(a)).toHaveLength(5);
  });

  it('tres réplicas trabajando sin conexión convergen al reconectar', () => {
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()] as const;
    const base = insertLine(docs[0], { cells: { nombre: 'Base' } });
    sync(docs[0], docs[1]);
    sync(docs[0], docs[2]);
    // Cada uno trabaja aislado.
    insertLine(docs[0], { cells: { nombre: 'Uno' } });
    setCell(docs[1], base, 'observaciones', 'Revisar audio');
    insertLine(docs[2], { index: 0, cells: { nombre: 'Tres' } });
    deleteLines(docs[1], []);
    // Reconectan en cualquier orden.
    sync(docs[2], docs[1]);
    sync(docs[0], docs[1]);
    sync(docs[2], docs[0]);
    const [r0, r1, r2] = docs.map(readLines);
    expect(r0).toEqual(r1);
    expect(r1).toEqual(r2);
    expect(r0!.map((l) => l.cells.nombre)).toEqual(['Tres', 'Base', 'Uno']);
    expect(r0![1]!.cells.observaciones).toBe('Revisar audio');
  });
});
