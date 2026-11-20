import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDuration, lineTypeLabel } from '@runflow/core';
import { Alert, Button, Spinner } from '@runflow/ui';
import { api, errorMessage } from '../api/client';
import { useCan } from '../auth/session';
import { PageHeader } from '../components/PageHeader';
import { fridgeKey, useFridge } from '../rundown/panels';

/** 02 Nevera: líneas preparadas para usar en cualquier escaleta. */
export function FridgePage() {
  const fridge = useFridge();
  const qc = useQueryClient();
  const canTemplates = useCan('templates.manage');
  const canStructure = useCan('rundown.edit_structure');
  const canDelete = canTemplates || canStructure;
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        number="02"
        title="Nevera"
        intro="Líneas preparadas (con su guion y rótulos) para insertar en cualquier escaleta desde el panel lateral."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {fridge.isPending ? (
        <div className="rf-center">
          <Spinner label="Cargando…" />
        </div>
      ) : fridge.isError ? (
        <Alert tone="error">{errorMessage(fridge.error)}</Alert>
      ) : fridge.data.length === 0 ? (
        <div className="rf-card rf-empty">
          La nevera está vacía. En una escaleta, clic derecho en una línea → «Guardar en la nevera».
        </div>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Duración</th>
                <th>Guion</th>
                <th className="rf-table__actions">
                  <span className="rf-visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fridge.data.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong>
                  </td>
                  <td>{lineTypeLabel(i.cells.tipo)}</td>
                  <td className="rf-tabular">
                    {typeof i.cells.t_est === 'number'
                      ? formatDuration(i.cells.t_est)
                      : typeof i.cells.dur_vtr === 'number'
                        ? formatDuration(i.cells.dur_vtr)
                        : ''}
                  </td>
                  <td className="rf-muted">
                    {i.script.length ? `${i.script.length} bloques` : '—'}
                  </td>
                  <td className="rf-table__actions">
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          try {
                            await api.delete(`/api/fridge/${i.id}`);
                            void qc.invalidateQueries({ queryKey: fridgeKey });
                          } catch (err) {
                            setError(errorMessage(err));
                          }
                        }}
                      >
                        Borrar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
