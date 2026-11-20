import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  GRAPHIC_TYPE_BY_KEY,
  GRAPHIC_TYPES,
  TIMECODE_LINE_TYPES,
  validateGraphic,
  type GraphicData,
  type GraphicFieldKey,
  type PersonDto,
} from '@runflow/core';
import { api, ApiError, errorMessage } from '../api/client';
import { useScriptContext } from './context';
import { rotulosToFocus } from './focus';

/** Tarjeta azul de un rótulo dentro del guion. */
export function RotuloView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  selected,
}: NodeViewProps) {
  const attrs = node.attrs as GraphicData;
  const ctx = useScriptContext();
  const type = GRAPHIC_TYPE_BY_KEY[attrs.type] ?? GRAPHIC_TYPES[0]!;
  const editable = editor.isEditable;
  const showTc = TIMECODE_LINE_TYPES.has(ctx.lineType);
  const issues = useMemo(
    () => validateGraphic(attrs, { pieceSeconds: ctx.pieceSeconds }),
    [attrs, ctx.pieceSeconds],
  );
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const withPeople = attrs.type === 'TOT' || attrs.type === 'INF';
  const [focusFirst] = useState(() => rotulosToFocus.has(attrs.id));
  useEffect(() => {
    rotulosToFocus.delete(attrs.id);
  }, [attrs.id]);

  return (
    <NodeViewWrapper
      className={`rf-rotulo${selected ? ' is-selected' : ''}${issues.length ? ' has-issues' : ''}`}
      data-rotulo-type={type.key}
      contentEditable={false}
    >
      <div className="rf-rotulo__head" data-drag-handle>
        <span className="rf-rotulo__grip" aria-hidden="true">
          ⋮⋮
        </span>
        <select
          className="rf-rotulo__type"
          value={type.key}
          disabled={!editable}
          aria-label="Tipo de rótulo"
          onChange={(e) => updateAttributes({ type: e.target.value })}
        >
          {GRAPHIC_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.key} · {t.name}
            </option>
          ))}
        </select>
        {showTc && (
          <span className="rf-rotulo__tc">
            <label>
              TC entrada
              <input
                value={attrs.tcIn}
                placeholder="mm:ss"
                maxLength={6}
                disabled={!editable}
                aria-invalid={!!issueFor('tcIn') || undefined}
                onChange={(e) => updateAttributes({ tcIn: e.target.value })}
              />
            </label>
            <label>
              TC salida
              <input
                value={attrs.tcOut}
                placeholder="mm:ss"
                maxLength={6}
                disabled={!editable}
                aria-invalid={!!issueFor('tcOut') || undefined}
                onChange={(e) => updateAttributes({ tcOut: e.target.value })}
              />
            </label>
          </span>
        )}
        {editable && (
          <button
            type="button"
            className="rf-rotulo__delete"
            aria-label="Quitar rótulo"
            onClick={() => deleteNode()}
          >
            ✕
          </button>
        )}
      </div>
      <div className="rf-rotulo__fields">
        {type.fields.map((f, i) => (
          <Field
            key={f.key}
            label={f.label}
            value={attrs[f.key] ?? ''}
            maxLength={f.maxLength}
            required={f.required}
            editable={editable}
            error={issueFor(f.key)}
            suggest={withPeople && i === 0}
            autoFocus={i === 0 && focusFirst}
            onChange={(v) => updateAttributes({ [f.key]: v })}
            onPick={(p) =>
              updateAttributes(
                attrs.type === 'TOT'
                  ? { f0: p.name.toUpperCase(), f1: p.title.toUpperCase() }
                  : { f0: p.name.toUpperCase() },
              )
            }
          />
        ))}
      </div>
      {showTc && (
        <p className="rf-rotulo__hint">
          {attrs.tcIn
            ? attrs.tcOut
              ? `Entra en ${attrs.tcIn} y sale en ${attrs.tcOut}`
              : `Entra en ${attrs.tcIn} y sale a los ${ctx.defaultSeconds} s`
            : 'Sin TC: se lanza a mano'}
        </p>
      )}
      {issues
        .filter((i) => i.field === 'type' || i.field === 'tcIn' || i.field === 'tcOut')
        .map((i) => (
          <p key={i.field + i.message} className="rf-rotulo__error" role="alert">
            {i.message}
          </p>
        ))}
      {editable && attrs.type === 'TOT' && attrs.f0 && (
        <SavePerson name={attrs.f0} title={attrs.f1} />
      )}
    </NodeViewWrapper>
  );
}

function Field({
  label,
  value,
  maxLength,
  required,
  editable,
  error,
  suggest,
  autoFocus,
  onChange,
  onPick,
}: {
  label: string;
  value: string;
  maxLength: number;
  required: boolean;
  editable: boolean;
  error?: string;
  suggest: boolean;
  autoFocus?: boolean;
  onChange(v: string): void;
  onPick(p: PersonDto): void;
}) {
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<PersonDto[]>([]);
  const timer = useRef<number>(0);
  const input = useRef<HTMLInputElement>(null);
  const [focusOnMount] = useState(!!autoFocus);
  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    if (!suggest || !focused || value.trim().length < 2) {
      setResults([]);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await api.get<{ people: PersonDto[] }>(
          `/api/people?q=${encodeURIComponent(value.trim())}`,
        );
        setResults(res.people.slice(0, 6));
      } catch {
        setResults([]);
      }
    }, 200);
    return () => window.clearTimeout(timer.current);
  }, [suggest, focused, value]);

  const near = value.length >= maxLength * 0.9;
  return (
    <label className={`rf-rotulo__field${error ? ' is-invalid' : ''}`}>
      <span className="rf-rotulo__label">
        {label}
        {required && ' *'}
        <span className={`rf-rotulo__count${near ? ' is-near' : ''}`}>
          {value.length}/{maxLength}
        </span>
      </span>
      <input
        ref={input}
        value={value}
        maxLength={maxLength}
        disabled={!editable}
        aria-label={label}
        aria-invalid={!!error || undefined}
        onChange={(e) => {
          // Escribir implica foco (aunque el campo se haya vuelto a montar).
          setFocused(true);
          onChange(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {results.length > 0 && (
        <ul className="rf-rotulo__suggest" role="listbox">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(p);
                  setResults([]);
                }}
              >
                <strong>{p.name}</strong> {p.title && <span>· {p.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="rf-rotulo__error">{error}</span>}
    </label>
  );
}

/** Guarda la persona del rótulo en la base de datos (si no existe ya). */
function SavePerson({ name, title }: { name: string; title: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'exists'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setState('idle');
    setError(null);
  }, [name, title]);
  if (state === 'saved') return <p className="rf-rotulo__hint">Guardado en personas y cargos.</p>;
  if (state === 'exists') return <p className="rf-rotulo__hint">Ya está en personas y cargos.</p>;
  if (error) return <p className="rf-rotulo__error">{error}</p>;
  return (
    <button
      type="button"
      className="rf-rotulo__save"
      disabled={state === 'saving'}
      onClick={async () => {
        setState('saving');
        try {
          await api.post('/api/people', { name: name.trim(), title: title.trim() });
          setState('saved');
        } catch (err) {
          if (err instanceof ApiError && err.status === 400 && err.fields.name) setState('exists');
          else {
            setState('idle');
            setError(errorMessage(err));
          }
        }
      }}
    >
      + Guardar en personas y cargos
    </button>
  );
}

export type { GraphicFieldKey };
