import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { LINE_TYPES, type ColumnDef, type ViewColumn } from '@runflow/core';
import type { CellChange, CellValue, LineSnapshot } from '@runflow/sync';
import { t } from '../i18n';
import { cellColors, displayValue, editValue, parseInput, parseTsv, toTsv } from './cells';
import type { PresenceUser } from './useRundownDoc';

export interface GridColumn {
  def: ColumnDef;
  width: number;
}

export interface GridActions {
  setCells(changes: CellChange[]): void;
  /** Inserta una línea en `index` y devuelve su id. */
  insertAt(index: number, cells?: Record<string, CellValue>): string;
  duplicate(id: string): void;
  move(id: string, toIndex: number): void;
  remove(ids: string[]): void;
  renumber(): void;
  undo(): void;
  redo(): void;
}

export interface CellRef {
  lineId: string;
  col: string;
}

export interface RowInfo {
  /** Estado en el directo. */
  state: 'played' | 'onAir' | 'next' | 'pending' | 'floating';
  /** Valores de las columnas calculadas (HORA, BACK TIME…). */
  computed: Record<string, string>;
}

export interface ExtraMenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  onClick(): void;
}

interface Props {
  lines: LineSnapshot[];
  columns: GridColumn[];
  canEditCells: boolean;
  canEditStructure: boolean;
  presence: PresenceUser[];
  actions: GridActions;
  onColumnsChange(columns: ViewColumn[]): void;
  onCursor(cell: CellRef | null): void;
  /** Estado de directo y columnas calculadas por línea. */
  rowInfo?: Map<string, RowInfo>;
  /** Opciones adicionales del menú contextual (directo, flotante, hora fija…). */
  extraMenu?: (ctx: { lineIds: string[]; focusLineId: string | null }) => ExtraMenuItem[];
  /** La barra espaciadora queda reservada para el GO. */
  reserveSpace?: boolean;
}

interface Pos {
  r: number;
  c: number;
}

interface Editing extends CellRef {
  draft: string;
  invalid: boolean;
}

interface Menu {
  x: number;
  y: number;
}

const MIN_WIDTH = 36;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function RundownGrid({
  lines,
  columns,
  canEditCells,
  canEditStructure,
  presence,
  actions,
  onColumnsChange,
  onCursor,
  rowInfo,
  extraMenu,
  reserveSpace,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focus, setFocus] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [rowDrag, setRowDrag] = useState<{ id: string; drop: number | null } | null>(null);
  const [colDrag, setColDrag] = useState<{ key: string; drop: number | null } | null>(null);
  const selecting = useRef(false);

  const rowIndex = useMemo(() => new Map(lines.map((l, i) => [l.id, i])), [lines]);
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.def.key, i])), [columns]);

  const toPos = useCallback(
    (ref: CellRef | null): Pos | null => {
      if (!ref) return null;
      const r = rowIndex.get(ref.lineId);
      const c = colIndex.get(ref.col);
      return r === undefined || c === undefined ? null : { r, c };
    },
    [rowIndex, colIndex],
  );
  const toRef = useCallback(
    (p: Pos): CellRef | null => {
      const line = lines[p.r];
      const col = columns[p.c];
      return line && col ? { lineId: line.id, col: col.def.key } : null;
    },
    [lines, columns],
  );

  const focusPos = toPos(focus);
  const anchorPos = toPos(anchor) ?? focusPos;
  const range =
    focusPos && anchorPos
      ? {
          r1: Math.min(focusPos.r, anchorPos.r),
          r2: Math.max(focusPos.r, anchorPos.r),
          c1: Math.min(focusPos.c, anchorPos.c),
          c2: Math.max(focusPos.c, anchorPos.c),
        }
      : null;

  // Si la línea con el foco desaparece (la borró otra persona), se suelta el foco.
  useEffect(() => {
    if (focus && !focusPos) {
      setFocus(null);
      setAnchor(null);
      setEditing(null);
    }
  }, [focus, focusPos]);

  useEffect(() => onCursor(focus), [focus, onCursor]);

  /** Columnas fijas a la izquierda: las primeras marcadas como fijas. */
  const pinnedLeft = useMemo(() => {
    const offsets: (number | undefined)[] = [];
    let left = 0;
    let pinning = true;
    for (const col of columns) {
      if (pinning && col.def.pinned) {
        offsets.push(left);
        left += col.width;
      } else {
        pinning = false;
        offsets.push(undefined);
      }
    }
    return offsets;
  }, [columns]);

  const presenceByCell = useMemo(() => {
    const map = new Map<string, PresenceUser[]>();
    for (const p of presence) {
      if (!p.cell) continue;
      const key = `${p.cell.lineId}:${p.cell.col}`;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [presence]);

  const refocus = () => containerRef.current?.focus({ preventScroll: true });

  const moveTo = useCallback(
    (p: Pos, extend = false) => {
      const ref = toRef({
        r: clamp(p.r, 0, lines.length - 1),
        c: clamp(p.c, 0, columns.length - 1),
      });
      if (!ref) return;
      setFocus(ref);
      if (!extend) setAnchor(ref);
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector(`[data-cell="${ref.lineId}:${ref.col}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    },
    [toRef, lines.length, columns.length],
  );

  function startEdit(ref: CellRef, initial?: string) {
    if (!canEditCells) return;
    const col = columns[colIndex.get(ref.col)!]!.def;
    if (col.kind === 'computed') return;
    const line = lines[rowIndex.get(ref.lineId)!]!;
    setEditing({ ...ref, draft: initial ?? editValue(col, line.cells[ref.col]), invalid: false });
  }

  function commit(next?: { dr: number; dc: number }, draftOverride?: string) {
    if (!editing) return;
    const col = columns[colIndex.get(editing.col) ?? -1]?.def;
    const line = lines[rowIndex.get(editing.lineId) ?? -1];
    if (!col || !line) return setEditing(null);
    const parsed = parseInput(col, draftOverride ?? editing.draft);
    if (!parsed.ok) {
      setEditing({ ...editing, invalid: true });
      return;
    }
    const current = line.cells[editing.col];
    if ((parsed.value ?? undefined) !== current) {
      actions.setCells([{ id: editing.lineId, key: editing.col, value: parsed.value }]);
    }
    setEditing(null);
    refocus();
    if (next && focusPos) moveTo({ r: focusPos.r + next.dr, c: focusPos.c + next.dc });
  }

  function cancelEdit() {
    setEditing(null);
    refocus();
  }

  /* ---------- Operaciones sobre la selección ---------- */

  const selectedLineIds = () => {
    if (!range) return [];
    return lines.slice(range.r1, range.r2 + 1).map((l) => l.id);
  };

  function clearSelection() {
    if (!range || !canEditCells) return;
    const changes: CellChange[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const line = lines[r]!;
        const key = columns[c]!.def.key;
        if (columns[c]!.def.kind === 'computed') continue;
        if (line.cells[key] !== undefined) changes.push({ id: line.id, key, value: null });
      }
    }
    if (changes.length) actions.setCells(changes);
  }

  function selectionTsv(): string {
    if (!range) return '';
    const rows: string[][] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const row: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) {
        const col = columns[c]!.def;
        const line = lines[r]!;
        row.push(
          col.kind === 'computed'
            ? (rowInfo?.get(line.id)?.computed[col.key] ?? '')
            : displayValue(col, line.cells[col.key]),
        );
      }
      rows.push(row);
    }
    return toTsv(rows);
  }

  function paste(text: string) {
    if (!canEditCells || !focusPos) return;
    const rows = parseTsv(text);
    if (rows.length === 0) return;
    const start = range ? { r: range.r1, c: range.c1 } : focusPos;
    const ids = lines.map((l) => l.id);
    // Si se pegan más filas de las que hay, se añaden líneas (como en una hoja de cálculo).
    if (canEditStructure) {
      for (let i = ids.length; i < start.r + rows.length; i++) ids.push(actions.insertAt(i));
    }
    const changes: CellChange[] = [];
    rows.forEach((row, i) => {
      const id = ids[start.r + i];
      if (!id) return;
      row.forEach((raw, j) => {
        const col = columns[start.c + j]?.def;
        if (!col || col.kind === 'computed') return;
        const parsed = parseInput(col, raw);
        if (parsed.ok) changes.push({ id, key: col.key, value: parsed.value });
      });
    });
    if (changes.length) actions.setCells(changes);
    const end = toRef({
      r: Math.min(start.r + rows.length - 1, ids.length - 1),
      c: Math.min(start.c + Math.max(...rows.map((r) => r.length)) - 1, columns.length - 1),
    });
    const startRef = toRef(start);
    if (startRef) setAnchor(startRef);
    if (end) setFocus(end);
  }

  function insertRelative(offset: 0 | 1) {
    if (!canEditStructure) return;
    const at = focusPos ? focusPos.r + offset : lines.length;
    const id = actions.insertAt(at);
    const col = columns.find((c) => c.def.key === 'nombre')?.def.key ?? columns[0]?.def.key;
    if (col) {
      const ref = { lineId: id, col };
      setFocus(ref);
      setAnchor(ref);
    }
  }

  function moveSelectedLine(delta: -1 | 1) {
    if (!canEditStructure || !focusPos || !range) return;
    if (range.r1 !== range.r2) return;
    const target = focusPos.r + delta;
    if (target < 0 || target >= lines.length) return;
    actions.move(lines[focusPos.r]!.id, target);
  }

  function deleteSelectedLines() {
    if (!canEditStructure) return;
    const ids = selectedLineIds();
    if (!ids.length) return;
    const nextRow = range ? Math.min(range.r1, lines.length - ids.length - 1) : 0;
    actions.remove(ids);
    setEditing(null);
    if (nextRow >= 0) {
      const remaining = lines.filter((l) => !ids.includes(l.id));
      const line = remaining[nextRow];
      if (line && focus) {
        const ref = { lineId: line.id, col: focus.col };
        setFocus(ref);
        setAnchor(ref);
      }
    }
  }

  /* ---------- Teclado ---------- */

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      return e.shiftKey ? actions.redo() : actions.undo();
    }
    if (mod && (key === 'y' || key === 'Y')) {
      e.preventDefault();
      return actions.redo();
    }
    if (mod && key === 'Enter') {
      e.preventDefault();
      return insertRelative(1);
    }
    if (mod && (key === 'd' || key === 'D')) {
      e.preventDefault();
      if (canEditStructure && focus) actions.duplicate(focus.lineId);
      return;
    }
    if (mod && key === 'Delete') {
      e.preventDefault();
      return deleteSelectedLines();
    }
    if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      e.preventDefault();
      return moveSelectedLine(key === 'ArrowUp' ? -1 : 1);
    }

    if (!focusPos) {
      if (key.startsWith('Arrow') && lines.length) {
        e.preventDefault();
        moveTo({ r: 0, c: 0 });
      }
      return;
    }

    const arrows: Record<string, Pos> = {
      ArrowUp: { r: -1, c: 0 },
      ArrowDown: { r: 1, c: 0 },
      ArrowLeft: { r: 0, c: -1 },
      ArrowRight: { r: 0, c: 1 },
    };
    if (arrows[key]) {
      e.preventDefault();
      const d = arrows[key];
      const target = mod
        ? {
            r: d.r < 0 ? 0 : d.r > 0 ? lines.length - 1 : focusPos.r,
            c: d.c < 0 ? 0 : d.c > 0 ? columns.length - 1 : focusPos.c,
          }
        : { r: focusPos.r + d.r, c: focusPos.c + d.c };
      return moveTo(target, e.shiftKey);
    }
    switch (key) {
      case 'Tab': {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        let { r, c } = focusPos;
        c += dir;
        if (c >= columns.length) {
          c = 0;
          r = Math.min(r + 1, lines.length - 1);
        } else if (c < 0) {
          c = columns.length - 1;
          r = Math.max(r - 1, 0);
        }
        return moveTo({ r, c });
      }
      case 'Home':
        e.preventDefault();
        return moveTo({ r: mod ? 0 : focusPos.r, c: 0 }, e.shiftKey);
      case 'End':
        e.preventDefault();
        return moveTo(
          { r: mod ? lines.length - 1 : focusPos.r, c: columns.length - 1 },
          e.shiftKey,
        );
      case 'PageDown':
        e.preventDefault();
        return moveTo({ r: focusPos.r + 15, c: focusPos.c }, e.shiftKey);
      case 'PageUp':
        e.preventDefault();
        return moveTo({ r: focusPos.r - 15, c: focusPos.c }, e.shiftKey);
      case 'Enter':
      case 'F2':
        e.preventDefault();
        return startEdit(focus!);
      case 'Escape':
        setAnchor(focus);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return clearSelection();
      default:
        break;
    }
    // Escribir directamente sobre la celda empieza la edición.
    if (key === ' ' && reserveSpace) return; // GO
    if (key.length === 1 && !mod && !e.altKey && canEditCells) {
      e.preventDefault();
      const col = columns[focusPos.c]!.def;
      if (col.kind === 'status') {
        const parsed = parseInput(col, key);
        if (parsed.ok) {
          actions.setCells([{ id: focus!.lineId, key: col.key, value: parsed.value }]);
          return moveTo({ r: focusPos.r + 1, c: focusPos.c });
        }
        return;
      }
      startEdit(focus!, col.kind === 'type' || col.kind === 'select' ? undefined : key);
    }
  }

  /* ---------- Portapapeles ---------- */

  function onCopy(e: ClipboardEvent<HTMLDivElement>) {
    if (editing || !range) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionTsv());
  }
  function onCut(e: ClipboardEvent<HTMLDivElement>) {
    if (editing || !range) return;
    onCopy(e);
    clearSelection();
  }
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (editing) return;
    e.preventDefault();
    paste(e.clipboardData.getData('text/plain'));
  }

  /* ---------- Ratón ---------- */

  function onCellMouseDown(e: MouseEvent, ref: CellRef) {
    if (e.button !== 0) return;
    if (editing && (editing.lineId !== ref.lineId || editing.col !== ref.col)) commit();
    if (e.shiftKey && focus) {
      setFocus(ref);
    } else {
      setAnchor(ref);
      setFocus(ref);
      selecting.current = true;
    }
    setMenu(null);
    if (!editing) e.preventDefault();
    refocus();
  }

  function onCellMouseEnter(ref: CellRef) {
    if (selecting.current) setFocus(ref);
  }

  useEffect(() => {
    const up = () => {
      selecting.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  function onContextMenu(e: MouseEvent, ref: CellRef) {
    e.preventDefault();
    const p = toPos(ref);
    const inside =
      p && range && p.r >= range.r1 && p.r <= range.r2 && p.c >= range.c1 && p.c <= range.c2;
    if (!inside) {
      setAnchor(ref);
      setFocus(ref);
    }
    setMenu({ x: e.clientX, y: e.clientY });
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // Se cierra con un clic fuera, con Escape o si la persona desplaza la rejilla
    // (no con desplazamientos automáticos, p. ej. al abrirse el panel de guion).
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest('.rf-menu')) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const scroller = containerRef.current;
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    scroller?.addEventListener('wheel', close, { passive: true });
    scroller?.addEventListener('touchmove', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      scroller?.removeEventListener('wheel', close);
      scroller?.removeEventListener('touchmove', close);
    };
  }, [menu]);

  /* ---------- Columnas: ancho y orden ---------- */

  function startResize(e: ReactPointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columns[index]!.width;
    const base = columns.map((c) => ({ key: c.def.key, width: c.width }));
    const onMove = (ev: PointerEvent) => {
      const width = Math.round(clamp(startWidth + ev.clientX - startX, MIN_WIDTH, 800));
      onColumnsChange(base.map((c, i) => (i === index ? { ...c, width } : c)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function dropColumn(targetIndex: number) {
    if (!colDrag) return;
    const list = columns.map((c) => ({ key: c.def.key, width: c.width }));
    const from = list.findIndex((c) => c.key === colDrag.key);
    if (from < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(targetIndex > from ? targetIndex - 1 : targetIndex, 0, moved!);
    onColumnsChange(list);
    setColDrag(null);
  }

  /* ---------- Render ---------- */

  const totalWidth = columns.reduce((s, c) => s + c.width, 0) + 1;
  const menuLines = selectedLineIds();

  return (
    <div
      ref={containerRef}
      className="rf-rgrid-scroll"
      tabIndex={0}
      role="grid"
      aria-rowcount={lines.length + 1}
      aria-colcount={columns.length}
      aria-readonly={!canEditCells}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
    >
      <table className="rf-rgrid" style={{ width: totalWidth }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.def.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr role="row">
            {columns.map((c, i) => (
              <th
                key={c.def.key}
                role="columnheader"
                title={c.def.description}
                className={[
                  pinnedLeft[i] !== undefined && 'is-pinned',
                  colDrag?.drop === i && 'is-drop-before',
                  colDrag?.drop === columns.length && i === columns.length - 1 && 'is-drop-after',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={pinnedLeft[i] !== undefined ? { left: pinnedLeft[i] } : undefined}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/x-rf-column', c.def.key);
                  setColDrag({ key: c.def.key, drop: null });
                }}
                onDragOver={(e) => {
                  if (!colDrag) return;
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const drop = e.clientX > rect.left + rect.width / 2 ? i + 1 : i;
                  if (drop !== colDrag.drop) setColDrag({ ...colDrag, drop });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (colDrag?.drop !== null && colDrag?.drop !== undefined)
                    dropColumn(colDrag.drop);
                }}
                onDragEnd={() => setColDrag(null)}
              >
                <span className="rf-rgrid__th-label">{c.def.label}</span>
                <span
                  className="rf-rgrid__resize"
                  onPointerDown={(e) => startResize(e, i)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Ancho de ${c.def.label}`}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, r) => {
            const inRows = range && r >= range.r1 && r <= range.r2;
            return (
              <Row
                key={line.id}
                line={line}
                info={rowInfo?.get(line.id)}
                rowNumber={r}
                columns={columns}
                pinnedLeft={pinnedLeft}
                selC1={inRows ? range.c1 : -1}
                selC2={inRows ? range.c2 : -1}
                focusCol={focus?.lineId === line.id ? focus.col : null}
                editing={editing?.lineId === line.id ? editing : null}
                presenceByCell={presenceByCell}
                canDrag={canEditStructure}
                dropBefore={rowDrag?.drop === r}
                dropAfter={rowDrag?.drop === lines.length && r === lines.length - 1}
                dragging={rowDrag?.id === line.id}
                onCellMouseDown={onCellMouseDown}
                onCellMouseEnter={onCellMouseEnter}
                onCellDoubleClick={(ref) => startEdit(ref)}
                onContextMenu={onContextMenu}
                onDraftChange={(draft) =>
                  setEditing((ed) => (ed ? { ...ed, draft, invalid: false } : ed))
                }
                onCommit={commit}
                onCancel={cancelEdit}
                onRowDragStart={(id) => setRowDrag({ id, drop: null })}
                onRowDragOver={(drop) =>
                  setRowDrag((d) => (d && d.drop !== drop ? { ...d, drop } : d))
                }
                onRowDrop={() => {
                  if (rowDrag && rowDrag.drop !== null) {
                    const from = rowIndex.get(rowDrag.id)!;
                    actions.move(rowDrag.id, rowDrag.drop > from ? rowDrag.drop - 1 : rowDrag.drop);
                  }
                  setRowDrag(null);
                }}
                onRowDragEnd={() => setRowDrag(null)}
              />
            );
          })}
        </tbody>
      </table>

      {menu && (
        <ul
          className="rf-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {extraMenu &&
            (() => {
              const items = extraMenu({ lineIds: menuLines, focusLineId: focus?.lineId ?? null });
              if (!items.length) return null;
              return (
                <>
                  {items.map((it) => (
                    <MenuItem
                      key={it.label}
                      label={it.label}
                      hint={it.hint}
                      danger={it.danger}
                      onClick={() => {
                        setMenu(null);
                        it.onClick();
                      }}
                    />
                  ))}
                  <li role="separator" className="rf-menu__sep" />
                </>
              );
            })()}
          {canEditStructure && (
            <>
              <MenuItem
                label={t('grid.menu.insertAbove')}
                onClick={() => (setMenu(null), insertRelative(0))}
              />
              <MenuItem
                label={t('grid.menu.insertBelow')}
                hint="Ctrl+Intro"
                onClick={() => (setMenu(null), insertRelative(1))}
              />
              <MenuItem
                label={t('grid.menu.duplicate')}
                hint="Ctrl+D"
                onClick={() => {
                  setMenu(null);
                  if (focus) actions.duplicate(focus.lineId);
                }}
              />
              <MenuItem
                label={t('grid.menu.moveUp')}
                hint="Alt+↑"
                onClick={() => (setMenu(null), moveSelectedLine(-1))}
              />
              <MenuItem
                label={t('grid.menu.moveDown')}
                hint="Alt+↓"
                onClick={() => (setMenu(null), moveSelectedLine(1))}
              />
              <li role="separator" className="rf-menu__sep" />
            </>
          )}
          {canEditCells && (
            <MenuItem
              label={t('grid.menu.clear')}
              hint="Supr"
              onClick={() => (setMenu(null), clearSelection())}
            />
          )}
          {canEditStructure && (
            <>
              <MenuItem
                label={t('grid.menu.renumber')}
                onClick={() => (setMenu(null), actions.renumber())}
              />
              <li role="separator" className="rf-menu__sep" />
              <MenuItem
                danger
                label={
                  menuLines.length > 1
                    ? t('grid.menu.deleteMany', { count: menuLines.length })
                    : t('grid.menu.delete')
                }
                hint="Ctrl+Supr"
                onClick={() => (setMenu(null), deleteSelectedLines())}
              />
            </>
          )}
        </ul>
      )}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  danger,
  onClick,
}: {
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        className={danger ? 'is-danger' : undefined}
        onClick={onClick}
      >
        <span>{label}</span>
        {hint && <kbd>{hint}</kbd>}
      </button>
    </li>
  );
}

/* ---------- Fila ---------- */

interface RowProps {
  line: LineSnapshot;
  info: RowInfo | undefined;
  rowNumber: number;
  columns: GridColumn[];
  pinnedLeft: (number | undefined)[];
  selC1: number;
  selC2: number;
  focusCol: string | null;
  editing: Editing | null;
  presenceByCell: Map<string, PresenceUser[]>;
  canDrag: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  dragging: boolean;
  onCellMouseDown(e: MouseEvent, ref: CellRef): void;
  onCellMouseEnter(ref: CellRef): void;
  onCellDoubleClick(ref: CellRef): void;
  onContextMenu(e: MouseEvent, ref: CellRef): void;
  onDraftChange(draft: string): void;
  onCommit(next?: { dr: number; dc: number }, draft?: string): void;
  onCancel(): void;
  onRowDragStart(id: string): void;
  onRowDragOver(drop: number): void;
  onRowDrop(): void;
  onRowDragEnd(): void;
}

const Row = memo(function Row(props: RowProps) {
  const { line, info, rowNumber, columns, pinnedLeft, selC1, selC2, focusCol, editing } = props;
  return (
    <tr
      role="row"
      data-line-id={line.id}
      data-state={info?.state}
      className={[
        info && `is-${info.state}`,
        props.dropBefore && 'is-drop-before',
        props.dropAfter && 'is-drop-after',
        props.dragging && 'is-dragging',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        props.onRowDragOver(e.clientY > rect.top + rect.height / 2 ? rowNumber + 1 : rowNumber);
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onRowDrop();
      }}
    >
      {columns.map((c, i) => {
        const key = c.def.key;
        const ref = { lineId: line.id, col: key };
        const value = line.cells[key];
        const colors = cellColors(c.def, value);
        const selected = i >= selC1 && i <= selC2;
        const isFocus = focusCol === key;
        const isEditing = editing?.col === key;
        const others = props.presenceByCell.get(`${line.id}:${key}`);
        const style: Record<string, string | number> = {};
        if (pinnedLeft[i] !== undefined) style.left = pinnedLeft[i]!;
        if (colors) {
          style['--cell-bg'] = colors.bg;
          style['--cell-fg'] = colors.fg;
        }
        if (others) style['--presence'] = others[0]!.color;
        return (
          <td
            key={key}
            role="gridcell"
            data-cell={`${line.id}:${key}`}
            data-col={key}
            aria-selected={selected || undefined}
            className={[
              `rf-cell rf-cell--${c.def.kind}`,
              c.def.align && `is-${c.def.align}`,
              colors && 'has-color',
              pinnedLeft[i] !== undefined && 'is-pinned',
              selected && 'is-selected',
              isFocus && 'is-focus',
              isEditing && 'is-editing',
              others && 'has-presence',
            ]
              .filter(Boolean)
              .join(' ')}
            style={style}
            onMouseDown={(e) => props.onCellMouseDown(e, ref)}
            onMouseEnter={() => props.onCellMouseEnter(ref)}
            onDoubleClick={() => props.onCellDoubleClick(ref)}
            onContextMenu={(e) => props.onContextMenu(e, ref)}
          >
            {isEditing ? (
              <CellEditor
                col={c.def}
                editing={editing!}
                onDraftChange={props.onDraftChange}
                onCommit={props.onCommit}
                onCancel={props.onCancel}
              />
            ) : (
              <>
                {key === 'num' && props.canDrag && (
                  <span
                    className="rf-drag-handle"
                    draggable
                    title="Arrastra para mover la línea"
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/x-rf-line', line.id);
                      props.onRowDragStart(line.id);
                    }}
                    onDragEnd={props.onRowDragEnd}
                  >
                    ⋮⋮
                  </span>
                )}
                <span className="rf-cell__text">
                  {c.def.kind === 'computed'
                    ? (info?.computed[key] ?? '')
                    : displayValue(c.def, value)}
                </span>
                {key === 'num' && info?.state === 'onAir' && (
                  <span className="rf-row-tag rf-row-tag--onair">EN AIRE</span>
                )}
                {key === 'num' && info?.state === 'next' && (
                  <span className="rf-row-tag rf-row-tag--next">SIG.</span>
                )}
                {key === 'num' && info?.state === 'floating' && (
                  <span className="rf-row-tag">FLOT.</span>
                )}
                {others && (
                  <span className="rf-cell__presence" style={{ background: others[0]!.color }}>
                    {others.map((o) => o.name.split(' ')[0]).join(', ')}
                  </span>
                )}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
});

/* ---------- Editor de celda ---------- */

function CellEditor({
  col,
  editing,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  col: ColumnDef;
  editing: Editing;
  onDraftChange(draft: string): void;
  onCommit(next?: { dr: number; dc: number }, draft?: string): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement & HTMLSelectElement>(null);
  // Foco síncrono: las teclas siguientes ya van al editor aunque se escriba muy rápido.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if ('setSelectionRange' in el && el.tagName !== 'SELECT') {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, []);

  const keyNav = (e: KeyboardEvent<HTMLElement>, allowNewline: boolean) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && !(allowNewline && (e.altKey || e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      onCommit({ dr: 1, dc: 0 });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onCommit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else {
      e.stopPropagation();
    }
  };

  if (col.kind === 'type' || col.kind === 'select' || col.kind === 'status') {
    const options = col.options ?? [];
    return (
      <select
        ref={ref}
        className="rf-cell__editor"
        value={editing.draft}
        aria-label={col.label}
        onChange={(e) => onCommit(undefined, e.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={(e) => keyNav(e, false)}
      >
        <option value="">—</option>
        {col.kind === 'type'
          ? TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.label}>
                {o.label}
              </option>
            ))
          : options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === o.label ? o.label : `${o.value} — ${o.label}`}
              </option>
            ))}
      </select>
    );
  }

  if (col.kind === 'text') {
    return (
      <textarea
        ref={ref}
        className={`rf-cell__editor${editing.invalid ? ' is-invalid' : ''}`}
        value={editing.draft}
        aria-label={col.label}
        rows={Math.min(6, editing.draft.split('\n').length)}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={(e) => keyNav(e, true)}
      />
    );
  }

  return (
    <input
      ref={ref}
      className={`rf-cell__editor${editing.invalid ? ' is-invalid' : ''}`}
      value={editing.draft}
      aria-label={col.label}
      aria-invalid={editing.invalid || undefined}
      inputMode={col.kind === 'seconds' ? 'numeric' : undefined}
      placeholder={col.kind === 'duration' ? 'm:ss' : undefined}
      onChange={(e) => onDraftChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => keyNav(e, false)}
    />
  );
}

const TYPE_OPTIONS = LINE_TYPES.map((t) => ({ value: t.key, label: t.label }));
