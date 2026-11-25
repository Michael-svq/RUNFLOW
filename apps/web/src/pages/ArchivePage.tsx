import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { SearchResultDto, TrashItemDto } from '@runflow/core';
import { Alert, Button, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { formatDate, formatDateTime } from '../i18n';
import { rundownsKey } from './RundownsPage';

/** 06 Archivo & Papelera: buscar en todas las escaletas y recuperar las borradas. */
export function ArchivePage() {
  const qc = useQueryClient();
  const canRestore = useCan('rundown.edit_structure');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: async () =>
      (await api.get<{ results: SearchResultDto[] }>(`/api/search?q=${encodeURIComponent(query)}`))
        .results,
    enabled: query.length >= 2,
  });
  const trash = useQuery({
    queryKey: ['trash'],
    queryFn: async () => (await api.get<{ items: TrashItemDto[] }>('/api/trash')).items,
  });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setNotice({ tone: 'success', text: ok });
      void qc.invalidateQueries({ queryKey: ['trash'] });
      void qc.invalidateQueries({ queryKey: rundownsKey });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) });
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Archivo & Papelera"
        intro="Busca en todas las escaletas y recupera las borradas."
      />
      <div className="rf-stack">
        <section className="rf-card rf-section">
          <h2 className="rf-section__title">Buscar en el archivo</h2>
          <form
            className="rf-search"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setQuery(q.trim());
            }}
          >
            <input
              className="rf-input"
              placeholder="Nombre de línea, persona, observación…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Buscar"
            />
            <Button type="submit" variant="primary" disabled={q.trim().length < 2}>
              Buscar
            </Button>
          </form>
          {query.length >= 2 &&
            (results.isPending ? (
              <Spinner label="Buscando…" />
            ) : results.isError ? (
              <Alert tone="error">{errorMessage(results.error)}</Alert>
            ) : results.data.length === 0 ? (
              <p className="rf-muted">Sin resultados para «{query}».</p>
            ) : (
              <ul className="rf-plain-list rf-results">
                {results.data.map((r) => (
                  <li key={`${r.rundownId}-${r.lineId}`}>
                    <Link to={`/escaletas/${r.rundownId}`} className="rf-link-strong">
                      {r.num} · {r.name || '(sin nombre)'}
                    </Link>
                    <span className="rf-muted rf-small">
                      {' '}
                      {r.rundownTitle} · {formatDate(`${r.airDate}T12:00:00`)}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </section>

        <section className="rf-card rf-section">
          <h2 className="rf-section__title">Papelera</h2>
          {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
          {trash.isPending ? (
            <Spinner label="Cargando…" />
          ) : trash.isError ? (
            <Alert tone="error">{errorMessage(trash.error)}</Alert>
          ) : trash.data.length === 0 ? (
            <p className="rf-muted">La papelera está vacía.</p>
          ) : (
            <ul className="rf-sidelist__items">
              {trash.data.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.title}</strong>
                    <span className="rf-muted rf-small">
                      {' '}
                      {i.programName} · {formatDate(`${i.airDate}T12:00:00`)} · borrada{' '}
                      {formatDateTime(i.deletedAt)}
                    </span>
                  </div>
                  {canRestore && (
                    <span className="rf-sidelist__confirm">
                      <Button
                        size="sm"
                        onClick={() =>
                          void act(
                            () => api.post(`/api/trash/${i.id}/restore`),
                            'Escaleta recuperada.',
                          )
                        }
                      >
                        Recuperar
                      </Button>
                      {confirm === i.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              void act(
                                () => api.delete(`/api/trash/${i.id}`),
                                'Escaleta eliminada para siempre.',
                              )
                            }
                          >
                            Confirmar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            No
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="danger" onClick={() => setConfirm(i.id)}>
                          Eliminar
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
