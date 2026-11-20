import { useState } from 'react';
import type * as Y from 'yjs';
import { COLUMN_BY_KEY, COLUMNS, type RundownDto } from '@runflow/core';
import {
  getScriptFragment,
  insertLine,
  readScript,
  writeScript,
  type CellValue,
  type LineSnapshot,
  type ScriptBlock,
} from '@runflow/sync';
import { Alert, Button, Dialog } from '@runflow/ui';
import { t } from '../i18n';
import { displayValue } from './cells';
import { detectHeader, download, parseCsv, rowsToLines, toCsv, type RawCell } from './importExport';
import type { RowInfo } from './RundownGrid';
import { LOCAL_ORIGIN } from './useRundownDoc';

interface Props {
  rundown: RundownDto;
  doc: Y.Doc;
  lines: LineSnapshot[];
  viewColumns: { key: string }[];
  rowInfo: Map<string, RowInfo>;
  canImport: boolean;
  onClose: () => void;
}

interface Pending {
  fileName: string;
  rows: RawCell[][];
  headerRow: number;
  mapping: (string | null)[];
}

interface BackupFile {
  format: 'runflow-escaleta';
  version: 1;
  title: string;
  lines: { cells: Record<string, CellValue>; script: ScriptBlock[] }[];
}

const safeName = (s: string) => s.replace(/[^\w-]+/g, '_').slice(0, 60);

/** Importar (CSV, XLSX, copia RunFlow) y exportar (CSV de la vista, copia completa). */
export function ImportExportDialog({
  rundown,
  doc,
  lines,
  viewColumns,
  rowInfo,
  canImport,
  onClose,
}: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );

  const exportCsv = () => {
    const cols = viewColumns.map((c) => COLUMN_BY_KEY[c.key]).filter(Boolean);
    const rows = [
      cols.map((c) => c!.label),
      ...lines.map((l) =>
        cols.map((c) =>
          c!.kind === 'computed'
            ? (rowInfo.get(l.id)?.computed[c!.key] ?? '')
            : displayValue(c!, l.cells[c!.key]),
        ),
      ),
    ];
    download(
      `${rundown.airDate}_${safeName(rundown.title)}.csv`,
      toCsv(rows),
      'text/csv;charset=utf-8',
    );
  };

  const exportBackup = () => {
    const data: BackupFile = {
      format: 'runflow-escaleta',
      version: 1,
      title: rundown.title,
      lines: lines.map((l) => ({
        cells: l.cells,
        script: readScript(getScriptFragment(doc, l.id)),
      })),
    };
    download(
      `${rundown.airDate}_${safeName(rundown.title)}.runflow.json`,
      JSON.stringify(data, null, 2),
      'application/json',
    );
  };

  async function onFile(file: File) {
    setNotice(null);
    setPending(null);
    setBackup(null);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) {
        const data = JSON.parse(await file.text()) as BackupFile;
        if (data.format !== 'runflow-escaleta' || !Array.isArray(data.lines))
          throw new Error('No es una copia de RunFlow');
        setBackup(data);
        return;
      }
      let rows: RawCell[][];
      if (name.endsWith('.xlsx')) {
        const { default: readXlsxFile } = await import('read-excel-file');
        rows = (await readXlsxFile(file)) as RawCell[][];
      } else {
        rows = parseCsv(await file.text());
      }
      const header = detectHeader(rows);
      if (!header) {
        setNotice({
          tone: 'error',
          text: 'No se reconoce la fila de cabecera (ESTADO, Nº, TIPO, NOMBRE…).',
        });
        return;
      }
      setPending({ fileName: file.name, rows, ...header });
    } catch (err) {
      setNotice({
        tone: 'error',
        text: `No se pudo leer el archivo: ${err instanceof Error ? err.message : ''}`,
      });
    }
  }

  const appendLines = (items: { cells: Record<string, CellValue>; script?: ScriptBlock[] }[]) => {
    doc.transact(() => {
      let index = lines.length;
      for (const item of items) {
        const { num, ...cells } = item.cells;
        const id = insertLine(doc, { index, cells: num ? { ...cells, num } : cells }, LOCAL_ORIGIN);
        if (item.script?.length) writeScript(doc, id, item.script, LOCAL_ORIGIN);
        index++;
      }
    }, LOCAL_ORIGIN);
  };

  const result = pending ? rowsToLines(pending.rows, pending.headerRow, pending.mapping) : null;

  return (
    <Dialog
      open
      title="Importar y exportar"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <section className="rf-io">
        <h3 className="rf-form__title">Exportar</h3>
        <div className="rf-form__actions">
          <Button onClick={exportCsv}>CSV (vista actual)</Button>
          <Button onClick={exportBackup}>Copia completa (con guiones)</Button>
        </div>
      </section>
      {canImport && (
        <section className="rf-io">
          <h3 className="rf-form__title">Importar</h3>
          <p className="rf-muted rf-small">
            Desde Excel (.xlsx), CSV o una copia de RunFlow (.json). Las líneas se añaden al final.
          </p>
          <input
            type="file"
            accept=".xlsx,.csv,.tsv,.txt,.json"
            aria-label="Archivo para importar"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
          {backup && (
            <div className="rf-io__preview">
              <p>
                Copia «{backup.title}»: {backup.lines.length} líneas con sus guiones.
              </p>
              <Button
                variant="primary"
                onClick={() => {
                  appendLines(backup.lines);
                  setNotice({ tone: 'success', text: `${backup.lines.length} líneas importadas.` });
                  setBackup(null);
                }}
              >
                Importar {backup.lines.length} líneas
              </Button>
            </div>
          )}
          {pending && result && (
            <div className="rf-io__preview">
              <p className="rf-small">
                <strong>{pending.fileName}</strong>: cabecera en la fila {pending.headerRow + 1}.
                Revisa a qué columna va cada una:
              </p>
              <div className="rf-io__mapping">
                {(pending.rows[pending.headerRow] ?? []).map((h, i) => (
                  <label key={i}>
                    <span>{String(h ?? '') || `(columna ${i + 1})`}</span>
                    <select
                      className="rf-select"
                      value={pending.mapping[i] ?? ''}
                      onChange={(e) =>
                        setPending({
                          ...pending,
                          mapping: pending.mapping.map((m, j) =>
                            j === i ? e.target.value || null : m === e.target.value ? null : m,
                          ),
                        })
                      }
                    >
                      <option value="">— ignorar —</option>
                      {COLUMNS.filter((c) => c.kind !== 'computed').map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="rf-small">
                {result.lines.length} líneas listas
                {result.skippedCells > 0 &&
                  ` · ${result.skippedCells} celdas con valores no válidos se omitirán`}
                .
              </p>
              <Button
                variant="primary"
                disabled={result.lines.length === 0}
                onClick={() => {
                  appendLines(result.lines.map((cells) => ({ cells })));
                  setNotice({ tone: 'success', text: `${result.lines.length} líneas importadas.` });
                  setPending(null);
                }}
              >
                Importar {result.lines.length} líneas
              </Button>
            </div>
          )}
        </section>
      )}
    </Dialog>
  );
}
