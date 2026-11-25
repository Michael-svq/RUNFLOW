import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GRAPHIC_TYPE_BY_KEY,
  GRAPHIC_TYPES,
  validateGraphic,
  type OrgSettings,
  type RundownDto,
} from '@runflow/core';
import {
  insertGraphic,
  moveGraphic,
  removeGraphic,
  updateGraphic,
  type LineSnapshot,
  type ScriptGraphicBlock,
} from '@runflow/sync';
import { Alert, Button, Spinner } from '@runflow/ui';
import { api } from '../api/client';
import { useCan, useSession } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { RundownPicker, useRundownChoice } from '../direction/RundownPicker';
import {
  lineName,
  lineNumber,
  planImport,
  sheetRows,
  toCsvRows,
  type GraphicFields,
  type SheetRow,
} from '../direction/graphicsSheet';
import { cgCommand, useCgContextValue } from '../rundown/cg';
import { download, parseCsv, toCsv } from '../rundown/importExport';
import { LOCAL_ORIGIN, useLines, useRundownSession } from '../rundown/useRundownDoc';
import { useScriptColumns } from '../script/useScripts';
import { settingsKey } from './ConfigPage';

/*
 * Dirección TV → Rotulación: todos los rótulos de la escaleta en una hoja,
 * en el orden del guion. Se crean, cambian, importan y exportan; ▶/■ los
 * lanza con el diseño configurado.
 */

export function GraphicsPage() {
  const choice = useRundownChoice();
  return (
    <>
      <PageHeader
        title="Rotulación"
        intro="Los rótulos de la escaleta en orden de guion. Cambia los campos en la propia celda, lanza con ▶ y saca con ■; salen con el diseño configurado."
        actions={
          choice.rundowns.length > 0 && (
            <RundownPicker
              rundowns={choice.rundowns}
              value={choice.rundown?.id ?? ''}
              onChange={choice.setId}
            />
          )
        }
      />
      {choice.loading ? (
        <Spinner label="Cargando…" />
      ) : !choice.rundown ? (
        <p className="rf-muted">No hay escaletas entre ayer y las próximas dos semanas.</p>
      ) : (
        <GraphicsSheet key={choice.rundown.id} rundown={choice.rundown} />
      )}
    </>
  );
}

const FIELDS = ['f0', 'f1', 'f2', 'f3'] as const;

function GraphicsSheet({ rundown }: { rundown: RundownDto }) {
  const { me, org } = useSession();
  const user = useMemo(() => ({ id: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const canEdit = useCan('script.edit_any');
  const canFire = useCan('cg.fire');
  const { session, status, loaded, cg, setCg } = useRundownSession(org.id, rundown.id, user);
  const doc = session?.doc;
  const lines = useLines(doc);
  const scripts = useScriptColumns(doc, lines);
  const graphicsByLine = useMemo(
    () => new Map([...scripts].map(([id, c]) => [id, c.graphics])),
    [scripts],
  );
  const rows = useMemo(() => sheetRows(lines, graphicsByLine), [lines, graphicsByLine]);
  const cgCtx = useCgContextValue({
    rundownId: rundown.id,
    state: cg,
    graphics: graphicsByLine,
    canFire,
    apply: setCg,
  });
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: async () => (await api.get<{ settings: OrgSettings }>('/api/org/settings')).settings,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [newLine, setNewLine] = useState('');
  const [newType, setNewType] = useState('TOT');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Rótulo recién creado: su primer campo recibe el foco en cuanto aparece. */
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    const input = document.querySelector<HTMLInputElement>(
      `[data-graphic="${focusId}"] input[data-field="f0"]`,
    );
    if (input) {
      input.focus();
      setFocusId(null);
    }
  }, [focusId, rows]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedRow = rows.find((r) => r.graphic.id === selected) ?? rows[0] ?? null;
  const targetLine = lines.find((l) => l.id === newLine) ?? selectedRow?.line ?? lines[0];

  const update = (row: SheetRow, patch: Partial<GraphicFields>) =>
    doc && updateGraphic(doc, row.line.id, row.graphic.id, patch, LOCAL_ORIGIN);

  const add = () => {
    if (!doc || !targetLine) return;
    const id = insertGraphic(
      doc,
      targetLine.id,
      { type: newType, f0: '', f1: '', f2: '', f3: '', tcIn: '', tcOut: '' },
      selectedRow?.line.id === targetLine.id ? { afterId: selectedRow.graphic.id } : {},
      LOCAL_ORIGIN,
    );
    setSelected(id);
    setFocusId(id);
  };

  const exportCsv = () => {
    const name = `rotulos-${rundown.airDate}-${rundown.title}`.replace(/[^\p{L}\p{N}-]+/gu, '_');
    download(`${name}.csv`, toCsv(toCsvRows(rows)), 'text/csv;charset=utf-8');
  };

  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !doc) return;
    const plan = planImport(parseCsv(await file.text()), lines, rows);
    doc.transact(() => {
      for (const u of plan.updates) {
        updateGraphic(doc, u.lineId, u.graphicId, u.fields, LOCAL_ORIGIN);
        if (u.toLineId) moveGraphic(doc, u.lineId, u.graphicId, u.toLineId, LOCAL_ORIGIN);
      }
      for (const i of plan.inserts) insertGraphic(doc, i.lineId, i.fields, {}, LOCAL_ORIGIN);
    }, LOCAL_ORIGIN);
    setNotice({
      tone: plan.updates.length + plan.inserts.length ? 'success' : 'error',
      text: `${plan.inserts.length} rótulos nuevos, ${plan.updates.length} actualizados${
        plan.skipped ? `, ${plan.skipped} filas sin noticia (Nº o nombre) en la escaleta` : ''
      }.`,
    });
  };

  if (!loaded && !rows.length) return <Spinner label="Abriendo la escaleta…" />;

  return (
    <div className="rf-graphics">
      <div className="rf-toolbar" role="toolbar" aria-label="Rotulación">
        {canEdit && (
          <>
            <label className="rf-graphics__pick">
              <span>Noticia</span>
              <select
                className="rf-select"
                aria-label="Noticia del rótulo nuevo"
                value={targetLine?.id ?? ''}
                onChange={(e) => setNewLine(e.target.value)}
              >
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {lineNumber(l)} · {lineName(l) || 'Sin nombre'}
                  </option>
                ))}
              </select>
            </label>
            <label className="rf-graphics__pick">
              <span>Plantilla</span>
              <select
                className="rf-select"
                aria-label="Plantilla del rótulo nuevo"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                {GRAPHIC_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key} · {t.name}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" onClick={add} disabled={!targetLine}>
              + Rótulo
            </Button>
            <span className="rf-toolbar__sep" />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              Importar CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              hidden
              aria-label="Archivo CSV de rótulos"
              onChange={(e) => void importCsv(e)}
            />
          </>
        )}
        <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows.length}>
          Exportar CSV
        </Button>
        <span className="rf-toolbar__spacer" />
        <span className="rf-muted rf-small">
          {rows.length} rótulos · {status === 'online' ? '● en línea' : status}
        </span>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {cgCtx.error && <Alert tone="error">RunFlow CG: {cgCtx.error}</Alert>}

      <div className="rf-graphics__body">
        <div className="rf-table-wrap rf-graphics__table">
          <table className="rf-table rf-sheet rf-gsheet" aria-label="Rótulos">
            <thead>
              <tr>
                <th className="is-num">#</th>
                <th>Nº</th>
                <th>Noticia</th>
                <th>Plantilla</th>
                <th>Campo 1</th>
                <th>Campo 2</th>
                <th>Campo 3</th>
                <th>Campo 4</th>
                <th>TC IN</th>
                <th>TC OUT</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="rf-muted">
                    Esta escaleta no tiene rótulos. Añade uno con «+ Rótulo» o importa un CSV.
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <GraphicRow
                  key={row.graphic.id}
                  index={i}
                  row={row}
                  lines={lines}
                  selected={selectedRow?.graphic.id === row.graphic.id}
                  canEdit={canEdit}
                  canFire={canFire && !!cg && Object.keys(cg.devices).length > 0}
                  onAir={!!cg?.graphics[row.graphic.id]}
                  done={!!cg?.done[row.graphic.id]}
                  confirmDelete={confirmDelete === row.graphic.id}
                  onSelect={() => setSelected(row.graphic.id)}
                  onUpdate={(patch) => update(row, patch)}
                  onMove={(toLineId) =>
                    doc && moveGraphic(doc, row.line.id, row.graphic.id, toLineId, LOCAL_ORIGIN)
                  }
                  onFire={(take) =>
                    void cgCommand(cgCtx.value, take ? 'take' : 'out', {
                      graphicId: row.graphic.id,
                    })
                  }
                  onDelete={() => {
                    if (confirmDelete !== row.graphic.id) return setConfirmDelete(row.graphic.id);
                    setConfirmDelete(null);
                    if (doc) removeGraphic(doc, row.line.id, row.graphic.id, LOCAL_ORIGIN);
                  }}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {selectedRow && (
          <GraphicPreview graphic={selectedRow.graphic} settings={settings.data ?? null} />
        )}
      </div>
    </div>
  );
}

function GraphicRow({
  index,
  row,
  lines,
  selected,
  canEdit,
  canFire,
  onAir,
  done,
  confirmDelete,
  onSelect,
  onUpdate,
  onMove,
  onFire,
  onDelete,
  onCancelDelete,
}: {
  index: number;
  row: SheetRow;
  lines: LineSnapshot[];
  selected: boolean;
  canEdit: boolean;
  canFire: boolean;
  onAir: boolean;
  done: boolean;
  confirmDelete: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<GraphicFields>) => void;
  onMove: (toLineId: string) => void;
  onFire: (take: boolean) => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { line, graphic: g } = row;
  const type = GRAPHIC_TYPE_BY_KEY[g.type];
  const issues = validateGraphic(g);
  const issueOf = (field: string) => issues.find((x) => x.field === field)?.message;
  const n = index + 1;
  return (
    <tr
      data-graphic={g.id}
      className={[selected && 'is-selected', onAir && 'is-onair', done && !onAir && 'is-done']
        .filter(Boolean)
        .join(' ')}
      onFocus={onSelect}
      onClick={onSelect}
    >
      <td className="is-num rf-tabular">{n}</td>
      <td className="rf-tabular">
        <strong>{lineNumber(line)}</strong>
      </td>
      <td>
        {canEdit ? (
          <select
            className="rf-gsheet__select"
            aria-label={`Noticia del rótulo ${n}`}
            value={line.id}
            onChange={(e) => onMove(e.target.value)}
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {lineNumber(l)} · {lineName(l) || 'Sin nombre'}
              </option>
            ))}
          </select>
        ) : (
          lineName(line)
        )}
      </td>
      <td>
        {canEdit ? (
          <select
            className="rf-gsheet__select rf-gsheet__type"
            aria-label={`Plantilla del rótulo ${n}`}
            value={g.type}
            onChange={(e) => onUpdate({ type: e.target.value })}
            title={issueOf('type')}
          >
            {!type && <option value={g.type}>{g.type || '—'}</option>}
            {GRAPHIC_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key}
              </option>
            ))}
          </select>
        ) : (
          g.type
        )}
      </td>
      {FIELDS.map((key, i) => {
        const def = type?.fields.find((f) => f.key === key);
        const issue = issueOf(key);
        return (
          <td key={key} className={def ? undefined : 'is-unused'}>
            <SheetInput
              label={`Campo ${i + 1} del rótulo ${n}${def ? ` (${def.label})` : ''}`}
              field={key}
              value={g[key]}
              placeholder={def?.label ?? ''}
              maxLength={def?.maxLength}
              disabled={!canEdit || (!def && !g[key])}
              invalid={issue}
              onCommit={(v) => onUpdate({ [key]: v })}
            />
          </td>
        );
      })}
      {(['tcIn', 'tcOut'] as const).map((key) => (
        <td key={key} className="rf-gsheet__tc">
          <SheetInput
            label={`${key === 'tcIn' ? 'TC IN' : 'TC OUT'} del rótulo ${n}`}
            field={key}
            value={g[key]}
            placeholder="mm:ss"
            disabled={!canEdit}
            invalid={issueOf(key)}
            onCommit={(v) => onUpdate({ [key]: v })}
          />
        </td>
      ))}
      <td>
        {onAir ? (
          <span className="rf-gsheet__state is-onair">EN AIRE</span>
        ) : done ? (
          <span className="rf-gsheet__state is-done">✔ EMITIDO</span>
        ) : issues.length ? (
          <span className="rf-gsheet__state is-bad" title={issues.map((x) => x.message).join('\n')}>
            ⚠ {issues.length}
          </span>
        ) : (
          <span className="rf-muted">—</span>
        )}
      </td>
      <td className="rf-gsheet__actions">
        {canFire && (
          <button
            type="button"
            className="rf-cg-btn"
            aria-label={`${onAir ? 'Sacar' : 'Lanzar'} rótulo ${n}`}
            onClick={(e) => {
              e.stopPropagation();
              onFire(!onAir);
            }}
          >
            {onAir ? '■' : '▶'}
          </button>
        )}
        {canEdit &&
          (confirmDelete ? (
            <>
              <button
                type="button"
                className="rf-btn rf-btn--danger rf-btn--sm"
                onClick={onDelete}
                aria-label={`Confirmar borrar el rótulo ${n}`}
              >
                Borrar
              </button>
              <button
                type="button"
                className="rf-btn rf-btn--ghost rf-btn--sm"
                onClick={onCancelDelete}
              >
                No
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rf-gsheet__del"
              aria-label={`Borrar el rótulo ${n}`}
              title="Borrar"
              onClick={onDelete}
            >
              🗑
            </button>
          ))}
      </td>
    </tr>
  );
}

/** Celda editable: cambia el rótulo al salir de la celda o con Intro; Esc deshace. */
function SheetInput({
  label,
  field,
  value,
  placeholder,
  maxLength,
  disabled,
  invalid,
  onCommit,
}: {
  label: string;
  field: string;
  value: string;
  placeholder: string;
  maxLength?: number;
  disabled: boolean;
  invalid?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  return (
    <input
      className={`rf-gsheet__input${invalid ? ' is-invalid' : ''}`}
      aria-label={label}
      data-field={field}
      value={draft ?? value}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      title={invalid}
      onFocus={() => {
        cancel.current = false;
        setDraft(value);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancel.current && draft !== null && draft !== value) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancel.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Vista previa del rótulo seleccionado con el diseño de la empresa (la plantilla de antena). */
function GraphicPreview({
  graphic,
  settings,
}: {
  graphic: ScriptGraphicBlock;
  settings: OrgSettings | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const design = settings?.cgDesign;
  const type = GRAPHIC_TYPE_BY_KEY[graphic.type] ? graphic.type : 'TOT';
  const data = useMemo(() => {
    const fields: Record<string, string> = {};
    for (const k of FIELDS) {
      const v = graphic[k];
      if (v) fields[k] = design?.uppercase ? v.toUpperCase() : v;
    }
    return { type, design, fields };
  }, [graphic, design, type]);
  const post = (cmd: 'update' | 'play', payload?: unknown) =>
    frame.current?.contentWindow?.postMessage({ runflowCg: true, cmd, data: payload }, '*');
  useEffect(() => {
    post('update', data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return (
    <aside className="rf-card rf-graphics__preview" aria-label="Vista previa">
      <h2 className="rf-tile__title">Vista previa · {type}</h2>
      <div className="rf-config__screen">
        <iframe
          ref={frame}
          key={type}
          title={`Vista previa del rótulo ${type}`}
          src={`/cg/templates/${type}.html?preview=1`}
          onLoad={() => {
            post('update', data);
            post('play');
          }}
        />
      </div>
      <p className="rf-muted rf-small">
        Con el diseño de Dirección TV → Diseño. {graphic.tcIn && `Entra en ${graphic.tcIn}. `}
        {graphic.tcOut && `Sale en ${graphic.tcOut}.`}
      </p>
    </aside>
  );
}
