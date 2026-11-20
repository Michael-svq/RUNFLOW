import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { DEFAULT_READING_WPS, formatDuration, graphicSummary } from '@runflow/core';
import { lineScript, type LineSnapshot, type ScriptGraphicBlock } from '@runflow/sync';

export interface ScriptColumns {
  grafismo: string;
  lectura: string;
  /** Rótulos de la línea (para ▶/■ en directo). */
  graphics: ScriptGraphicBlock[];
}

/**
 * Columnas calculadas a partir de los guiones (GRAFISMO y T. LECTURA),
 * recalculadas cuando cambia el documento (agrupado por fotograma).
 */
export function useScriptColumns(
  doc: Y.Doc | undefined,
  lines: LineSnapshot[],
): Map<string, ScriptColumns> {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!doc) return;
    let frame = 0;
    const onUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };
    doc.on('update', onUpdate);
    return () => {
      cancelAnimationFrame(frame);
      doc.off('update', onUpdate);
    };
  }, [doc]);

  return useMemo(() => {
    const out = new Map<string, ScriptColumns>();
    if (!doc) return out;
    for (const l of lines) {
      const s = lineScript(doc, l.id, DEFAULT_READING_WPS);
      out.set(l.id, {
        grafismo: s.graphics.map(graphicSummary).join('\n'),
        lectura: s.pasoWords > 0 ? formatDuration(s.readingSeconds) : '',
        graphics: s.graphics,
      });
    }
    return out;
    // `version` fuerza el recálculo cuando cambia el documento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, lines, version]);
}
