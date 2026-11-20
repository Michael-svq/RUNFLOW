import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { insertLine, readLines, setCell } from './rundown-doc';
import { lineScript, writeScript } from './script';
import { compactState, docFromState, replaceContent } from './snapshot';

function sample() {
  const doc = new Y.Doc();
  const a = insertLine(doc, { cells: { nombre: 'A', estado: 'E', t_est: 30 } });
  insertLine(doc, { cells: { nombre: 'B' } });
  writeScript(doc, a, [
    { kind: 'paso', text: 'Hola' },
    {
      kind: 'rotulo',
      id: 'r',
      type: 'LOC',
      f0: 'SEVILLA',
      f1: '',
      f2: '',
      f3: '',
      tcIn: '',
      tcOut: '',
    },
  ]);
  return { doc, a };
}

describe('copias de contenido', () => {
  it('una plantilla conserva líneas y guiones y quita los estados', () => {
    const { doc, a } = sample();
    const tpl = docFromState(compactState(doc, { clearStatus: true }));
    expect(readLines(tpl).map((l) => l.cells.nombre)).toEqual(['A', 'B']);
    expect(readLines(tpl)[0]!.cells.estado).toBeUndefined();
    expect(lineScript(tpl, a).paso).toEqual(['Hola']);
    expect(lineScript(tpl, a).graphics[0]!.f0).toBe('SEVILLA');
  });

  it('restaurar sustituye el contenido y llega a los demás clientes', () => {
    const { doc } = sample();
    const version = docFromState(compactState(doc));
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    // Cambios posteriores que se quieren deshacer
    const lines = readLines(doc);
    setCell(doc, lines[1]!.id, 'nombre', 'B cambiada');
    const c = insertLine(doc, { cells: { nombre: 'C' } });
    writeScript(doc, c, [{ kind: 'paso', text: 'Texto C' }]);
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)));

    replaceContent(doc, version);
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)));
    for (const d of [doc, other]) {
      expect(readLines(d).map((l) => l.cells.nombre)).toEqual(['A', 'B']);
      expect(lineScript(d, c).paso).toEqual([]);
    }
  });
});
