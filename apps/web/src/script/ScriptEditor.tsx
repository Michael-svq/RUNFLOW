import { useEffect, useMemo, useState } from 'react';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  DEFAULT_GRAPHIC_SECONDS,
  DEFAULT_READING_WPS,
  formatDuration,
  GRAPHIC_TYPES,
  lineTypeLabel,
  overlappingGraphics,
} from '@runflow/core';
import { lineScript, scriptField, type LineSnapshot, type ScriptKind } from '@runflow/sync';
import { Button } from '@runflow/ui';
import { ScriptContext } from './context';
import { Rotulo, ScriptParagraph } from './extensions';

const KINDS: { kind: ScriptKind; label: string; hint: string }[] = [
  { kind: 'paso', label: 'Paso', hint: 'Lo que lee el presentador (Ctrl+1)' },
  { kind: 'off', label: 'Off', hint: 'Lo que se locuta en la pieza (Ctrl+2)' },
  { kind: 'nota', label: 'Nota', hint: 'Indicación interna; no sale en el prompter (Ctrl+3)' },
];

interface Props {
  doc: Y.Doc;
  provider: WebsocketProvider;
  line: LineSnapshot;
  editable: boolean;
  user: { id: string; name: string; color: string };
  /** Escribe la duración de lectura en TIEMPO ESTIMADO. */
  onUseReadingTime?: (seconds: number) => void;
}

/**
 * Editor de guion colaborativo de una línea: paso (verde), off (negro),
 * notas (gris) y rótulos (azul, estructurados).
 */
export function ScriptEditor({ doc, provider, line, editable, user, onUseReadingTime }: Props) {
  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({
          history: false, // el deshacer lo lleva la colaboración
          paragraph: false,
          heading: false,
          codeBlock: false,
          code: false,
          blockquote: false,
          horizontalRule: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          strike: false,
        }),
        ScriptParagraph,
        Rotulo,
        Collaboration.configure({ document: doc, field: scriptField(line.id) }),
        CollaborationCursor.configure({ provider, user }),
      ],
      editorProps: {
        attributes: {
          class: 'rf-script__doc',
          'aria-label': `Guion de la línea ${String(line.cells.num ?? '')}`,
          spellcheck: 'true',
          lang: 'es',
        },
      },
    },
    [doc, provider, line.id],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Resumen en vivo (palabras, lectura, rótulos).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => setTick((n) => n + 1);
    editor.on('update', update);
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('update', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor]);
  const summary = lineScript(doc, line.id, DEFAULT_READING_WPS);
  const overlaps = overlappingGraphics(summary.graphics);
  const currentKind = (editor?.getAttributes('paragraph').kind as ScriptKind | undefined) ?? null;
  const lineType = String(line.cells.tipo ?? '');
  const pieceSeconds = typeof line.cells.dur_vtr === 'number' ? line.cells.dur_vtr : null;
  const ctx = useMemo(
    () => ({ lineType, pieceSeconds, defaultSeconds: DEFAULT_GRAPHIC_SECONDS }),
    [lineType, pieceSeconds],
  );

  return (
    <ScriptContext.Provider value={ctx}>
      <div className="rf-script">
        <div className="rf-script__title">
          <span className="rf-script__num">{String(line.cells.num ?? '')}</span>
          <span className="rf-script__name">{String(line.cells.nombre ?? '') || 'Sin título'}</span>
          {lineType && <span className="rf-script__type">{lineTypeLabel(lineType)}</span>}
        </div>

        {editable && (
          <div className="rf-script__toolbar" role="toolbar" aria-label="Formato del guion">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                className={`rf-script__kind rf-script__kind--${k.kind}${currentKind === k.kind ? ' is-active' : ''}`}
                title={k.hint}
                aria-pressed={currentKind === k.kind}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor?.chain().focus().setScriptKind(k.kind).run()}
              >
                {k.label}
              </button>
            ))}
            <select
              className="rf-script__add"
              value=""
              aria-label="Añadir rótulo"
              title="Añadir rótulo (Ctrl+Mayús+R: TOT)"
              onChange={(e) => {
                if (e.target.value) editor?.chain().focus().insertRotulo(e.target.value).run();
              }}
            >
              <option value="">+ Rótulo…</option>
              {GRAPHIC_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key} · {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <EditorContent editor={editor} className="rf-script__editor" />

        <div className="rf-script__stats" aria-live="polite">
          <span>
            <span className="rf-script__dot rf-script__dot--paso" /> Paso: {summary.pasoWords}{' '}
            palabras ·{' '}
            <strong data-testid="reading-time">{formatDuration(summary.readingSeconds)}</strong>
          </span>
          <span>
            <span className="rf-script__dot rf-script__dot--off" /> Off: {summary.offWords} palabras
          </span>
          <span>
            <span className="rf-script__dot rf-script__dot--rotulo" /> Rótulos:{' '}
            {summary.graphics.length}
          </span>
          {editable && onUseReadingTime && summary.readingSeconds > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUseReadingTime(summary.readingSeconds)}
            >
              Usar como tiempo estimado
            </Button>
          )}
        </div>
        {overlaps.length > 0 && (
          <p className="rf-script__warning">
            ⚠ Hay rótulos que se solapan en el tiempo ({overlaps.length}). Revisa sus TC.
          </p>
        )}
      </div>
    </ScriptContext.Provider>
  );
}
