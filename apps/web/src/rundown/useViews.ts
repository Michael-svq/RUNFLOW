import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BUILTIN_VIEWS, COLUMN_BY_KEY, type SavedViewDto, type ViewColumn } from '@runflow/core';
import { api } from '../api/client';

export const viewsKey = ['views'] as const;

export interface ViewOption {
  id: string;
  name: string;
  columns: ViewColumn[];
  builtin: boolean;
  shared: boolean;
  canEdit: boolean;
}

/** Vista inicial según el rol (PLAN §23: vistas por puesto). */
function defaultViewFor(roleKey: string): string {
  switch (roleKey) {
    case 'realizador':
      return 'builtin:realizacion';
    case 'redactor':
    case 'alumno':
      return 'builtin:redaccion';
    case 'produccion':
      return 'builtin:produccion';
    case 'tecnico':
    case 'operador_cg':
      return 'builtin:tecnica';
    default:
      return 'builtin:completa';
  }
}

function storageKey(orgId: string) {
  return `rf-view:${orgId}`;
}

function readStored(orgId: string): string | null {
  try {
    return localStorage.getItem(storageKey(orgId));
  } catch {
    return null;
  }
}

/** Solo columnas que existen (una vista guardada puede tener columnas retiradas). */
function clean(columns: ViewColumn[]): ViewColumn[] {
  return columns.filter((c) => COLUMN_BY_KEY[c.key]);
}

/**
 * Vista activa de la escaleta: columnas, orden y anchos. Los cambios (mover,
 * redimensionar, mostrar u ocultar) quedan "sin guardar" hasta guardarlos
 * como vista.
 */
export function useViews(orgId: string, roleKey: string) {
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: viewsKey,
    queryFn: async () => (await api.get<{ views: SavedViewDto[] }>('/api/views')).views,
    staleTime: 60_000,
  });

  const options: ViewOption[] = useMemo(
    () => [
      ...BUILTIN_VIEWS.map((v) => ({
        id: v.id,
        name: v.name,
        columns: v.columns,
        builtin: true,
        shared: true,
        canEdit: false,
      })),
      ...(saved.data ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        columns: clean(v.columns),
        builtin: false,
        shared: v.shared,
        canEdit: v.canEdit,
      })),
    ],
    [saved.data],
  );

  const [selectedId, setSelectedId] = useState(() => readStored(orgId) ?? defaultViewFor(roleKey));
  const selected = options.find((o) => o.id === selectedId) ?? options[0]!;
  const [working, setWorking] = useState<ViewColumn[] | null>(null);

  // Al cambiar de vista se descartan los cambios sin guardar.
  useEffect(() => setWorking(null), [selected.id]);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(storageKey(orgId), id);
    } catch {
      // Sin almacenamiento: la elección dura la sesión.
    }
  };

  const columns = working ?? selected.columns;

  async function save(input: { name: string; shared: boolean; asNew: boolean }) {
    const body = { name: input.name, shared: input.shared, columns };
    const res =
      !input.asNew && !selected.builtin && selected.canEdit
        ? await api.patch<{ view: SavedViewDto }>(`/api/views/${selected.id}`, {
            ...body,
            shared: selected.shared,
          })
        : await api.post<{ view: SavedViewDto }>('/api/views', body);
    await qc.invalidateQueries({ queryKey: viewsKey });
    setWorking(null);
    select(res.view.id);
  }

  async function remove(id: string) {
    await api.delete(`/api/views/${id}`);
    await qc.invalidateQueries({ queryKey: viewsKey });
    if (id === selected.id) select(defaultViewFor(roleKey));
  }

  return {
    options,
    selected,
    columns,
    dirty: working !== null,
    setColumns: (next: ViewColumn[]) => setWorking(next),
    reset: () => setWorking(null),
    select,
    save,
    remove,
  };
}
