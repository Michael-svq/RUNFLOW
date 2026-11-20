import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import {
  COLUMN_BY_KEY,
  COLUMNS,
  formatDuration,
  LINE_STATUSES,
  RUNDOWN_STATUSES,
  updateRundownInput,
  type RundownDto,
  type ViewColumn,
} from '@runflow/core';
import {
  deleteLines,
  duplicateLine,
  insertLine,
  moveLine,
  renumber,
  setCells,
  type LineSnapshot,
} from '@runflow/sync';
import { Alert, Badge, Button, Dialog, SelectField, Spinner, TextField } from '@runflow/ui';
import { api, ApiError, errorMessage } from '../api/client';
import { useCan, useSession } from '../auth/session';
import { locale, t } from '../i18n';
import { useFormState, validate } from '../lib/forms';
import {
  RundownGrid,
  type CellRef,
  type ExtraMenuItem,
  type GridActions,
} from '../rundown/RundownGrid';
import {
  AsrunDialog,
  HardTimeDialog,
  LiveBar,
  LiveClocks,
  readKeyboardPref,
  useClockFormat,
  useLiveCommands,
  useRowInfo,
  useTiming,
} from '../rundown/live';
import { useServerNow } from '../rundown/useServerClock';
import { ScriptEditor } from '../script/ScriptEditor';
import { OutputsDialog, StageMessageDialog } from '../outputs/OutputsDialog';
import { ImportExportDialog } from '../rundown/ImportExportDialog';
import {
  ChatTab,
  FridgeTab,
  saveLineToFridge,
  useChat,
  VersionsTab,
  fridgeKey,
} from '../rundown/panels';
import { CgBar, CgProvider, GraphicsCell, PlayCell, useCgContextValue } from '../rundown/cg';
import { useScriptColumns } from '../script/useScripts';
import { LINE_FLAGS } from '@runflow/core';
import {
  LOCAL_ORIGIN,
  colorFor,
  useLines,
  usePresence,
  useRundownSession,
  useUndoState,
  type ConnectionStatus,
} from '../rundown/useRundownDoc';
import { useViews } from '../rundown/useViews';
import { plannedSeconds, rundownsKey, statusLabel } from './RundownsPage';

export function RundownPage() {
  const { id = '' } = useParams();
  const rundown = useQuery({
    queryKey: ['rundown', id],
    queryFn: async () => (await api.get<{ rundown: RundownDto }>(`/api/rundowns/${id}`)).rundown,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  if (rundown.isPending) {
    return (
      <div className="rf-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (rundown.isError) {
    const notFound = rundown.error instanceof ApiError && rundown.error.status === 404;
    return (
      <div className="rf-stack">
        <Alert tone="error">{notFound ? t('grid.notFound') : errorMessage(rundown.error)}</Alert>
        <div>
          <Link to="/escaletas" className="rf-btn rf-btn--secondary">
            ‹ {t('grid.back')}
          </Link>
        </div>
      </div>
    );
  }
  return <RundownEditor key={id} rundown={rundown.data} />;
}

function RundownEditor({ rundown }: { rundown: RundownDto }) {
  const { me, org } = useSession();
  const queryClient = useQueryClient();
  const canEditCellsPerm = useCan('rundown.edit_cells');
  const canEditStructure = useCan('rundown.edit_structure');
  const canShare = useCan('program.configure');
  const canGo = useCan('live.go');
  const canScriptOwn = useCan('script.edit_own');
  const canScriptAny = useCan('script.edit_any');
  const canEditScript = canScriptOwn || canScriptAny;
  const canEditCells = canEditCellsPerm || canEditStructure;
  const canPrompter = useCan('prompter.control');
  const canControl = canPrompter || canGo;
  const canTemplates = useCan('templates.manage');
  const user = useMemo(() => ({ id: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const canFire = useCan('cg.fire');
  const { session, status, loaded, live, stage, setStage, cg, setCg, mixers } = useRundownSession(
    org.id,
    rundown.id,
    user,
  );
  const lines = useLines(session?.doc);
  const presence = usePresence(session?.provider);
  const undoState = useUndoState(session?.undo);
  const views = useViews(org.id, org.role.key);
  const [dialog, setDialog] = useState<
    | 'columns'
    | 'saveView'
    | 'meta'
    | 'shortcuts'
    | 'asrun'
    | 'outputs'
    | 'message'
    | 'template'
    | 'io'
    | 'print'
    | null
  >(null);
  const [hardTimeFor, setHardTimeFor] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [keyboardGo, setKeyboardGo] = useState(readKeyboardPref);

  // Tiempos: relojes cada 250 ms, columnas calculadas cada segundo.
  const now = useServerNow(250);
  const nowSecond = Math.floor(now / 1000) * 1000;
  const timing = useTiming(lines, rundown, live, nowSecond);
  const clock = useClockFormat(rundown.timezone);
  const scriptColumns = useScriptColumns(session?.doc, lines);
  const graphicsByLine = useMemo(
    () => new Map([...scriptColumns].map(([id, c]) => [id, c.graphics])),
    [scriptColumns],
  );
  const cgCtx = useCgContextValue({
    rundownId: rundown.id,
    state: cg,
    graphics: graphicsByLine,
    canFire,
    apply: setCg,
  });
  const renderCell = useCallback((line: LineSnapshot, key: string) => {
    if (key === 'grafismo') return <GraphicsCell lineId={line.id} />;
    if (key === 'play') return <PlayCell line={line} />;
    return undefined;
  }, []);
  const rowInfo = useRowInfo(timing, clock, scriptColumns);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [scriptOpen, setScriptOpen] = useState(() => {
    try {
      return localStorage.getItem('rf-script-panel') !== '0';
    } catch {
      return true;
    }
  });
  type PanelTab = 'guion' | 'chat' | 'nevera' | 'versiones';
  const [panelTab, setPanelTab] = useState<PanelTab>('guion');
  const chat = useChat(rundown.id, session?.provider, scriptOpen && panelTab === 'chat');
  const openPanel = (tab: PanelTab) => {
    setPanelTab(tab);
    if (!scriptOpen) toggleScript();
  };
  const toggleScript = () =>
    setScriptOpen((v) => {
      try {
        localStorage.setItem('rf-script-panel', v ? '0' : '1');
      } catch {
        // sin almacenamiento
      }
      return !v;
    });

  const showLiveError = useCallback((message: string) => {
    setLiveError(message);
    setTimeout(() => setLiveError((m) => (m === message ? null : m)), 4000);
  }, []);
  const commands = useLiveCommands(rundown.id, live, session?.applyLive, showLiveError);

  // Barra espaciadora = GO (si se activa), salvo escribiendo en un campo.
  useEffect(() => {
    if (!canGo || !keyboardGo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)))
        return;
      e.preventDefault();
      void commands.go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canGo, keyboardGo, commands]);

  const actions: GridActions = useMemo(() => {
    const doc = session?.doc;
    return {
      setCells: (changes) => doc && setCells(doc, changes, LOCAL_ORIGIN),
      insertAt: (index, cells) => (doc ? insertLine(doc, { index, cells }, LOCAL_ORIGIN) : ''),
      duplicate: (lineId) => doc && duplicateLine(doc, lineId, LOCAL_ORIGIN),
      move: (lineId, to) => doc && moveLine(doc, lineId, to, LOCAL_ORIGIN),
      remove: (ids) => doc && deleteLines(doc, ids, LOCAL_ORIGIN),
      renumber: () => doc && renumber(doc, 2, LOCAL_ORIGIN),
      undo: () => session?.undo.undo(),
      redo: () => session?.undo.redo(),
    };
  }, [session]);

  const onCursor = useCallback(
    (cell: CellRef | null) => {
      session?.provider.awareness.setLocalStateField('cell', cell);
      if (cell) setSelectedLineId(cell.lineId);
    },
    [session],
  );

  const gridColumns = views.columns
    .map((c) => ({ def: COLUMN_BY_KEY[c.key]!, width: c.width }))
    .filter((c) => c.def);
  const summary = { lineCount: lines.length, estimatedSeconds: timing.totalEstimated };
  const planned = plannedSeconds(rundown.startTime, rundown.endTime);
  const editable = canEditCells && status !== 'denied' && status !== 'deleted';
  const people = useMemo(() => {
    const seen = new Map<string, { name: string; color: string }>();
    for (const p of presence) seen.set(p.userId, { name: p.name, color: p.color });
    seen.delete(me.user.id);
    return [...seen.values()];
  }, [presence, me.user.id]);

  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;
  const scriptUser = useMemo(
    () => ({ id: me.user.id, name: me.user.name, color: colorFor(me.user.id) }),
    [me.user.id, me.user.name],
  );

  const extraMenu = useCallback(
    ({
      lineIds,
      focusLineId,
    }: {
      lineIds: string[];
      focusLineId: string | null;
    }): ExtraMenuItem[] => {
      const items: ExtraMenuItem[] = [];
      const focusLine = lines.find((l) => l.id === focusLineId);
      if (canGo && focusLine && lineIds.length === 1) {
        items.push({
          label: 'Fijar como siguiente',
          onClick: () => void commands.setNext(focusLine.id),
        });
        if (live?.next)
          items.push({
            label: 'Quitar siguiente elegida',
            onClick: () => void commands.setNext(null),
          });
      }
      if (focusLine && lineIds.length === 1 && session && (canEditStructure || canEditScript)) {
        items.push({
          label: 'Guardar en la nevera',
          onClick: () => {
            const name = String(focusLine.cells.nombre ?? '') || 'Línea sin título';
            saveLineToFridge(session.doc, focusLine, name)
              .then(() => {
                void queryClient.invalidateQueries({ queryKey: fridgeKey });
                openPanel('nevera');
              })
              .catch((err: unknown) =>
                showLiveError(err instanceof Error ? err.message : 'No se pudo guardar'),
              );
          },
        });
      }
      if (editable && lineIds.length > 0 && session) {
        const selected = lines.filter((l) => lineIds.includes(l.id));
        const allFloating = selected.every((l) => l.cells[LINE_FLAGS.floating] === '1');
        items.push({
          label: allFloating ? 'Quitar flotante' : 'Marcar como flotante',
          onClick: () =>
            actions.setCells(
              selected.map((l) => ({
                id: l.id,
                key: LINE_FLAGS.floating,
                value: allFloating ? null : '1',
              })),
            ),
        });
        if (focusLine) {
          const isBlock = focusLine.cells[LINE_FLAGS.block] === '1';
          items.push({
            label: isBlock ? 'Quitar inicio de bloque' : 'Inicio de bloque (reloj propio)',
            onClick: () =>
              actions.setCells([
                { id: focusLine.id, key: LINE_FLAGS.block, value: isBlock ? null : '1' },
              ]),
          });
          const hard = String(focusLine.cells[LINE_FLAGS.hardTime] ?? '');
          items.push({
            label: hard ? `Hora fija: ${hard}…` : 'Hora fija…',
            onClick: () => setHardTimeFor(focusLine.id),
          });
          const auto = focusLine.cells[LINE_FLAGS.autonext];
          const mark = (v: unknown) => (auto === v ? ' ✓' : '');
          items.push(
            {
              label: `Autonext: según el tipo${mark(undefined)}`,
              onClick: () =>
                actions.setCells([{ id: focusLine.id, key: LINE_FLAGS.autonext, value: null }]),
            },
            {
              label: `Autonext: siempre${mark('1')}`,
              onClick: () =>
                actions.setCells([{ id: focusLine.id, key: LINE_FLAGS.autonext, value: '1' }]),
            },
            {
              label: `Autonext: nunca${mark('0')}`,
              onClick: () =>
                actions.setCells([{ id: focusLine.id, key: LINE_FLAGS.autonext, value: '0' }]),
            },
          );
        }
      }
      return items;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lines,
      canGo,
      commands,
      live?.next,
      editable,
      session,
      actions,
      canEditStructure,
      canEditScript,
    ],
  );

  const dateRaw = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${rundown.airDate}T12:00:00`));
  const dateText = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);

  return (
    <CgProvider value={cgCtx.value}>
      <div className="rf-rundown">
        <div className="rf-rundown__head">
          <div className="rf-rundown__title">
            <Link to="/escaletas" className="rf-rundown__back">
              ‹ {t('grid.back')}
            </Link>
            <h1>
              {rundown.title}{' '}
              <Badge tone={rundown.status === 'en_aire' ? 'accent' : 'default'}>
                {statusLabel(rundown.status)}
              </Badge>
            </h1>
            <p className="rf-muted">
              {rundown.title !== rundown.programName && `${rundown.programName} · `}
              {dateText} ·{' '}
              <span className="rf-tabular">
                {rundown.startTime.slice(0, 5)}–{rundown.endTime.slice(0, 5)}
              </span>
            </p>
          </div>
          <div className="rf-rundown__summary rf-tabular">
            <span>{t('grid.lines', { count: summary.lineCount })}</span>
            <span className={summary.estimatedSeconds > planned ? 'rf-text-danger' : undefined}>
              {t('grid.estimated', {
                estimated: formatDuration(summary.estimatedSeconds),
                planned: formatDuration(planned),
              })}
            </span>
          </div>
        </div>

        <LiveClocks rundown={rundown} timing={timing} live={live} lines={lines} now={now} />
        <LiveBar
          live={live}
          lines={lines}
          timing={timing}
          commands={commands}
          canGo={canGo && status !== 'denied' && status !== 'deleted'}
          error={liveError}
          onShowAsrun={() => setDialog('asrun')}
          keyboard={keyboardGo}
          onKeyboardChange={setKeyboardGo}
        />
        <CgBar canGo={canGo} mixers={mixers} />
        {cgCtx.error && <Alert tone="error">RunFlow CG: {cgCtx.error}</Alert>}
        <div className="rf-toolbar" role="toolbar" aria-label="Escaleta">
          <label className="rf-toolbar__view">
            <span className="rf-visually-hidden">{t('grid.view')}</span>
            <select
              className="rf-select"
              value={views.selected.id}
              onChange={(e) => views.select(e.target.value)}
              aria-label={t('grid.view')}
            >
              <optgroup label={t('grid.builtinViews')}>
                {views.options
                  .filter((v) => v.builtin)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </optgroup>
              {views.options.some((v) => !v.builtin) && (
                <optgroup label={t('grid.savedViews')}>
                  {views.options
                    .filter((v) => !v.builtin)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.shared ? ' ·' : ''}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          </label>
          <Button size="sm" onClick={() => setDialog('columns')}>
            {t('grid.columns')}
          </Button>
          {views.dirty && (
            <>
              <Button size="sm" variant="primary" onClick={() => setDialog('saveView')}>
                {t('grid.saveView')}
              </Button>
              <Button size="sm" variant="ghost" onClick={views.reset} title={t('grid.resetView')}>
                ↺
              </Button>
            </>
          )}
          <span className="rf-toolbar__sep" />
          {editable && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={actions.undo}
                disabled={!undoState.canUndo}
                title={`${t('grid.undo')} (Ctrl+Z)`}
                aria-label={t('grid.undo')}
              >
                ↶
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={actions.redo}
                disabled={!undoState.canRedo}
                title={`${t('grid.redo')} (Ctrl+Y)`}
                aria-label={t('grid.redo')}
              >
                ↷
              </Button>
            </>
          )}
          {editable && canEditStructure && (
            <Button
              size="sm"
              onClick={() => actions.insertAt(lines.length)}
              title={t('grid.addLineTitle')}
            >
              + {t('grid.addLine')}
            </Button>
          )}
          <ToolbarMenu label="Escaleta">
            {canEditStructure && (
              <button type="button" role="menuitem" onClick={() => setDialog('meta')}>
                {t('rundowns.edit')}
              </button>
            )}
            {canTemplates && (
              <button type="button" role="menuitem" onClick={() => setDialog('template')}>
                Guardar como plantilla
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => setDialog('io')}>
              Importar/Exportar
            </button>
            <button type="button" role="menuitem" onClick={() => setDialog('print')}>
              Imprimir / PDF
            </button>
            <button type="button" role="menuitem" onClick={() => setDialog('asrun')}>
              Registro de emisión
            </button>
          </ToolbarMenu>
          <Button size="sm" variant="ghost" onClick={() => setDialog('outputs')}>
            Salidas
          </Button>
          {canControl && (
            <Link
              to={`/escaletas/${rundown.id}/prompter`}
              className="rf-btn rf-btn--ghost rf-btn--sm"
            >
              Prompter
            </Link>
          )}
          {canControl && session && (
            <Button
              size="sm"
              variant={stage?.text ? 'secondary' : 'ghost'}
              onClick={() => setDialog('message')}
              title={stage?.text ? `En pantalla: ${stage.text}` : 'Enviar un mensaje al plató'}
            >
              Mensaje{stage?.text ? ' ●' : ''}
            </Button>
          )}
          <Button
            size="sm"
            variant={scriptOpen ? 'secondary' : 'ghost'}
            onClick={toggleScript}
            aria-pressed={scriptOpen}
            title="Mostrar u ocultar el panel (guion, chat, nevera, versiones)"
          >
            Panel{chat.unread > 0 && !scriptOpen ? ` · ${chat.unread} chat` : ''}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog('shortcuts')}
            aria-label={t('grid.shortcuts')}
          >
            ⌨
          </Button>
          <span className="rf-toolbar__spacer" />
          {!canEditCells && <Badge tone="muted">{t('grid.readOnly')}</Badge>}
          <div className="rf-presence" aria-label="Personas en la escaleta">
            {people.map((p) => (
              <span
                key={p.name + p.color}
                className="rf-presence__avatar"
                style={{ background: p.color }}
                title={p.name}
              >
                {p.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase()}
              </span>
            ))}
            <span
              className="rf-presence__avatar rf-presence__avatar--me"
              style={{ background: colorFor(me.user.id) }}
              title={me.user.name}
            >
              {me.user.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase()}
            </span>
          </div>
          <ConnectionBadge status={status} />
        </div>

        {status === 'deleted' && <Alert tone="warning">{t('grid.deleted')}</Alert>}
        {status === 'denied' && <Alert tone="error">{t('grid.notFound')}</Alert>}

        {!session || !loaded ? (
          <div className="rf-center">
            <Spinner label={t('common.loading')} />
          </div>
        ) : lines.length === 0 ? (
          <div className="rf-card rf-empty">
            <p>{t('grid.empty')}</p>
            {editable && canEditStructure && (
              <Button variant="primary" onClick={() => actions.insertAt(0)}>
                {t('grid.emptyAction')}
              </Button>
            )}
          </div>
        ) : (
          <div className="rf-rundown__body">
            <RundownGrid
              lines={lines}
              columns={gridColumns}
              canEditCells={editable}
              canEditStructure={editable && canEditStructure}
              presence={presence}
              actions={actions}
              onColumnsChange={views.setColumns}
              onCursor={onCursor}
              rowInfo={rowInfo}
              extraMenu={extraMenu}
              reserveSpace={canGo && keyboardGo}
              renderCell={renderCell}
            />
            {scriptOpen && (
              <aside className="rf-script-panel" aria-label="Panel">
                <div className="rf-panel-tabs" role="tablist">
                  {(
                    [
                      ['guion', 'Guion'],
                      ['chat', chat.unread ? `Chat (${chat.unread})` : 'Chat'],
                      ['nevera', 'Nevera'],
                      ['versiones', 'Versiones'],
                    ] as [PanelTab, string][]
                  ).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={panelTab === tab}
                      className={`rf-panel-tabs__tab${panelTab === tab ? ' is-active' : ''}`}
                      onClick={() => setPanelTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  className="rf-panel-body"
                  role="tabpanel"
                  aria-label={panelTab === 'guion' ? 'Guion' : panelTab}
                >
                  {panelTab === 'guion' &&
                    (selectedLine && session ? (
                      <ScriptEditor
                        key={selectedLine.id}
                        doc={session.doc}
                        provider={session.provider}
                        line={selectedLine}
                        editable={canEditScript && status !== 'denied' && status !== 'deleted'}
                        user={scriptUser}
                        onUseReadingTime={
                          canEditCells
                            ? (seconds) =>
                                actions.setCells([
                                  { id: selectedLine.id, key: 't_est', value: seconds },
                                ])
                            : undefined
                        }
                      />
                    ) : (
                      <p className="rf-script-panel__empty">
                        Selecciona una línea para ver o escribir su guion.
                      </p>
                    ))}
                  {panelTab === 'chat' && <ChatTab chat={chat} meId={me.user.id} />}
                  {panelTab === 'nevera' && session && (
                    <FridgeTab
                      doc={session.doc}
                      insertIndex={
                        selectedLine
                          ? lines.findIndex((l) => l.id === selectedLine.id) + 1
                          : lines.length
                      }
                      canInsert={editable && canEditStructure}
                      onInserted={(id) => setSelectedLineId(id)}
                    />
                  )}
                  {panelTab === 'versiones' && (
                    <VersionsTab
                      rundownId={rundown.id}
                      canSave={editable}
                      canRestore={canEditStructure}
                    />
                  )}
                </div>
              </aside>
            )}
          </div>
        )}

        <div className="rf-legend" aria-label={t('grid.legend')}>
          {LINE_STATUSES.map((s) => (
            <span key={s.value} className="rf-legend__item">
              {s.label}{' '}
              <span className="rf-legend__chip" style={{ background: s.bg, color: s.fg }}>
                {s.value}
              </span>
            </span>
          ))}
        </div>

        {dialog === 'columns' && (
          <ColumnsDialog
            columns={views.columns}
            onChange={views.setColumns}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'saveView' && (
          <SaveViewDialog
            current={views.selected}
            canShare={canShare}
            onSave={views.save}
            onDelete={views.selected.canEdit ? () => views.remove(views.selected.id) : undefined}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'meta' && <MetaDialog rundown={rundown} onClose={() => setDialog(null)} />}
        {dialog === 'template' && (
          <TemplateDialog rundown={rundown} onClose={() => setDialog(null)} />
        )}
        {dialog === 'io' && session && (
          <ImportExportDialog
            rundown={rundown}
            doc={session.doc}
            lines={lines}
            viewColumns={views.columns}
            rowInfo={rowInfo}
            canImport={editable && canEditStructure}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'print' && (
          <PrintDialog rundownId={rundown.id} onClose={() => setDialog(null)} />
        )}
        {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
        {dialog === 'asrun' && <AsrunDialog rundown={rundown} onClose={() => setDialog(null)} />}
        {dialog === 'outputs' && (
          <OutputsDialog
            rundownId={rundown.id}
            canManage={canControl}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'message' && session && (
          <StageMessageDialog
            provider={session.provider}
            current={stage}
            from={me.user.name}
            onSent={setStage}
            onClose={() => setDialog(null)}
          />
        )}
        {hardTimeFor && (
          <HardTimeDialog
            current={String(
              lines.find((l) => l.id === hardTimeFor)?.cells[LINE_FLAGS.hardTime] ?? '',
            )}
            onSave={(value) =>
              actions.setCells([{ id: hardTimeFor, key: LINE_FLAGS.hardTime, value }])
            }
            onClose={() => setHardTimeFor(null)}
          />
        )}
      </div>
    </CgProvider>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === 'online') {
    return (
      <span className="rf-conn rf-conn--online" title={t('grid.status.online')}>
        ● {t('grid.status.online')}
      </span>
    );
  }
  if (status === 'connecting') {
    return <span className="rf-conn">● {t('grid.status.connecting')}</span>;
  }
  if (status === 'offline') {
    return (
      <span className="rf-conn rf-conn--offline" title={t('grid.status.offline')} role="status">
        ● {t('grid.status.offlineShort')}
      </span>
    );
  }
  return null;
}

function ColumnsDialog({
  columns,
  onChange,
  onClose,
}: {
  columns: ViewColumn[];
  onChange: (c: ViewColumn[]) => void;
  onClose: () => void;
}) {
  const visible = new Set(columns.map((c) => c.key));
  return (
    <Dialog
      open
      title={t('grid.columns')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <p className="rf-muted rf-small">
        Marca las columnas que quieres ver. Para cambiar el orden o el ancho, arrastra la cabecera o
        su borde en la escaleta. Después, guarda la vista.
      </p>
      <ul className="rf-check-list">
        {COLUMNS.map((c) => (
          <li key={c.key}>
            <label>
              <input
                type="checkbox"
                checked={visible.has(c.key)}
                disabled={visible.has(c.key) && visible.size === 1}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...columns, { key: c.key, width: c.width }]
                      : columns.filter((x) => x.key !== c.key),
                  )
                }
              />
              <span>
                <strong>{c.label}</strong>
                <span className="rf-muted rf-small"> — {c.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function SaveViewDialog({
  current,
  canShare,
  onSave,
  onDelete,
  onClose,
}: {
  current: { name: string; builtin: boolean; canEdit: boolean; shared: boolean };
  canShare: boolean;
  onSave: (input: { name: string; shared: boolean; asNew: boolean }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const canUpdate = !current.builtin && current.canEdit;
  const [name, setName] = useState(canUpdate ? current.name : '');
  const [shared, setShared] = useState(false);
  const form = useFormState();

  async function submit(asNew: boolean) {
    if (!name.trim()) return form.setFieldErrors({ name: 'Obligatorio' });
    const ok = await form.submit(async () => {
      await onSave({ name: name.trim(), shared, asNew });
      return true;
    });
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      title={t('grid.saveView')}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button
              variant="danger"
              className="rf-dialog__left"
              onClick={async () => {
                const ok = await form.submit(async () => {
                  await onDelete();
                  return true;
                });
                if (ok) onClose();
              }}
            >
              {t('grid.deleteView')}
            </Button>
          )}
          {canUpdate && (
            <Button onClick={() => submit(false)} loading={form.submitting}>
              {t('grid.updateView', { name: current.name })}
            </Button>
          )}
          <Button variant="primary" onClick={() => submit(true)} loading={form.submitting}>
            {t('grid.saveViewAs')}
          </Button>
        </>
      }
    >
      {form.formError && <Alert tone="error">{form.formError}</Alert>}
      <TextField
        label={t('grid.viewName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={form.fieldErrors.name}
        autoFocus
      />
      {canShare && (
        <label className="rf-checkbox">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>
            {t('grid.viewShared')}
            <span className="rf-field__hint"> {t('grid.viewSharedHint')}</span>
          </span>
        </label>
      )}
    </Dialog>
  );
}

function MetaDialog({ rundown, onClose }: { rundown: RundownDto; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState({
    title: rundown.title,
    airDate: rundown.airDate,
    startTime: rundown.startTime.slice(0, 5),
    endTime: rundown.endTime.slice(0, 5),
    status: rundown.status as string,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useFormState();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = validate(updateRundownInput, values);
    if (!data) return form.setFieldErrors(errors);
    const res = await form.submit(() =>
      api.patch<{ rundown: RundownDto }>(`/api/rundowns/${rundown.id}`, data),
    );
    if (res) {
      qc.setQueryData(['rundown', rundown.id], res.rundown);
      void qc.invalidateQueries({ queryKey: rundownsKey });
      onClose();
    }
  }

  return (
    <Dialog
      open
      title={t('rundowns.edit')}
      onClose={onClose}
      footer={
        <>
          {!confirmDelete && (
            <Button
              variant="danger"
              className="rf-dialog__left"
              onClick={() => setConfirmDelete(true)}
            >
              {t('rundowns.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="rundown-meta" loading={form.submitting}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {confirmDelete ? (
        <>
          <Alert tone="warning">{t('rundowns.deleteBody', { title: rundown.title })}</Alert>
          <div className="rf-form__actions">
            <Button
              variant="danger"
              loading={form.submitting}
              onClick={async () => {
                const ok = await form.submit(() => api.delete(`/api/rundowns/${rundown.id}`));
                if (ok) {
                  void qc.invalidateQueries({ queryKey: rundownsKey });
                  navigate('/escaletas', { replace: true });
                }
              }}
            >
              {t('rundowns.delete')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <form id="rundown-meta" className="rf-form" onSubmit={onSubmit} noValidate>
          {form.formError && <Alert tone="error">{form.formError}</Alert>}
          <TextField
            label={t('rundowns.field.title')}
            value={values.title}
            onChange={set('title')}
            error={form.fieldErrors.title}
          />
          <TextField
            label={t('rundowns.field.date')}
            type="date"
            value={values.airDate}
            onChange={set('airDate')}
            error={form.fieldErrors.airDate}
          />
          <div className="rf-form__row">
            <TextField
              label={t('rundowns.field.start')}
              type="time"
              value={values.startTime}
              onChange={set('startTime')}
              error={form.fieldErrors.startTime}
            />
            <TextField
              label={t('rundowns.field.end')}
              type="time"
              value={values.endTime}
              onChange={set('endTime')}
              error={form.fieldErrors.endTime}
            />
          </div>
          <SelectField
            label={t('rundowns.field.status')}
            value={values.status}
            onChange={set('status')}
            options={RUNDOWN_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          />
        </form>
      )}
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Flechas', 'Moverse por la escaleta (con Mayús: seleccionar)'],
  ['Intro / F2', 'Editar la celda (Intro de nuevo: guardar y bajar)'],
  ['Escribir', 'Empezar a editar la celda con lo que escribes'],
  ['C · E · X · A', 'En ESTADO: cae, emitido, no listo, final'],
  ['Alt+Intro', 'Salto de línea dentro de una celda de texto'],
  ['Tab / Mayús+Tab', 'Celda siguiente / anterior'],
  ['Esc', 'Cancelar la edición'],
  ['Supr', 'Vaciar las celdas seleccionadas'],
  ['Ctrl+C · Ctrl+X · Ctrl+V', 'Copiar, cortar y pegar (compatible con Excel y Google Sheets)'],
  ['Ctrl+Z · Ctrl+Y', 'Deshacer y rehacer tus cambios'],
  ['Ctrl+Intro', 'Nueva línea debajo'],
  ['Ctrl+D', 'Duplicar la línea'],
  ['Alt+↑ / Alt+↓', 'Subir o bajar la línea'],
  ['Ctrl+Supr', 'Borrar las líneas seleccionadas'],
  ['Clic derecho', 'Menú de la línea (siguiente, flotante, hora fija, autonext)'],
  ['Espacio', 'GO (si activas «Espacio = GO» en la barra de directo)'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title={t('grid.shortcutsTitle')} onClose={onClose}>
      <table className="rf-shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

/** Guarda la escaleta actual como plantilla (sin estados de línea). */
function TemplateDialog({ rundown, onClose }: { rundown: RundownDto; onClose: () => void }) {
  const [name, setName] = useState(rundown.programName);
  const [description, setDescription] = useState('');
  const [done, setDone] = useState(false);
  const form = useFormState();
  return (
    <Dialog
      open
      title="Guardar como plantilla"
      onClose={onClose}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={form.submitting}
              onClick={async () => {
                if (!name.trim()) return form.setFieldErrors({ name: 'Obligatorio' });
                const ok = await form.submit(() =>
                  api.post(`/api/rundowns/${rundown.id}/save-as-template`, { name, description }),
                );
                if (ok) setDone(true);
              }}
            >
              {t('common.save')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success">
          Plantilla «{name}» guardada. Elígela al crear una escaleta nueva.
        </Alert>
      ) : (
        <>
          <p className="rf-muted rf-small">
            Se guardan las líneas, columnas y guiones (sin los estados C/E/X/A) para crear escaletas
            iguales más adelante.
          </p>
          {form.formError && <Alert tone="error">{form.formError}</Alert>}
          <TextField
            label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={form.fieldErrors.name}
          />
          <TextField
            label="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      )}
    </Dialog>
  );
}

export const PRINT_VIEWS = [
  { value: 'completa', label: 'Escaleta completa' },
  { value: 'realizacion', label: 'Escaleta de realización' },
  { value: 'produccion', label: 'Escaleta de producción' },
  { value: 'tecnica', label: 'Escaleta técnica' },
  { value: 'presentador', label: 'Guion del presentador (solo paso)' },
  { value: 'guion', label: 'Guion completo (paso, off y rótulos)' },
  { value: 'rotulos', label: 'Hoja de rótulos' },
  { value: 'asrun', label: 'Registro de emisión' },
] as const;

/** Elige la vista de impresión y la abre en una pestaña nueva (Imprimir → Guardar como PDF). */
function PrintDialog({ rundownId, onClose }: { rundownId: string; onClose: () => void }) {
  const [view, setView] = useState<string>('completa');
  return (
    <Dialog
      open
      title="Imprimir o guardar en PDF"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <a
            className="rf-btn rf-btn--primary"
            href={`/escaletas/${rundownId}/imprimir?vista=${view}`}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            Abrir vista de impresión
          </a>
        </>
      }
    >
      <p className="rf-muted rf-small">
        Se abre una página lista para imprimir. En el diálogo de impresión, elige «Guardar como PDF»
        para obtener el archivo.
      </p>
      <fieldset className="rf-choice-group">
        {PRINT_VIEWS.map((v) => (
          <label key={v.value} className={`rf-choice${view === v.value ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="print-view"
              value={v.value}
              checked={view === v.value}
              onChange={() => setView(v.value)}
            />
            <span>{v.label}</span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

/** Menú desplegable de la barra de herramientas. */
function ToolbarMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  return (
    <details ref={ref} className="rf-tbmenu">
      <summary className="rf-btn rf-btn--ghost rf-btn--sm">{label} ▾</summary>
      <div
        className="rf-menu rf-tbmenu__list"
        role="menu"
        onClick={() => {
          if (ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
