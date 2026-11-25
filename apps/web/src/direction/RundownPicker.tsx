import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RundownDto } from '@runflow/core';
import { SelectField } from '@runflow/ui';
import { api } from '../api/client';

/* Elegir una escaleta (de ayer a dos semanas vista); recuerda la última elegida. */

const KEY = 'rf-direction-rundown';
const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function useRundownChoice(): {
  rundowns: RundownDto[];
  rundown: RundownDto | null;
  setId: (id: string) => void;
  loading: boolean;
} {
  const now = new Date();
  const from = iso(new Date(now.getTime() - 86_400_000));
  const to = iso(new Date(now.getTime() + 14 * 86_400_000));
  const list = useQuery({
    queryKey: ['rundowns', from, to, 'direction'],
    queryFn: async () =>
      (
        await api.get<{ rundowns: RundownDto[] }>(
          `/api/rundowns?${new URLSearchParams({ from, to })}`,
        )
      ).rundowns,
  });
  const [id, setIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });
  const rundowns = list.data ?? [];
  const today = iso(now);
  const rundown =
    rundowns.find((r) => r.id === id) ??
    rundowns.find((r) => r.status === 'en_aire') ??
    rundowns.find((r) => r.airDate === today) ??
    rundowns[0] ??
    null;
  useEffect(() => {
    if (rundown && rundown.id !== id) setIdState(rundown.id);
  }, [rundown, id]);
  const setId = (next: string) => {
    setIdState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // sin almacenamiento
    }
  };
  return { rundowns, rundown, setId, loading: list.isPending };
}

export function RundownPicker({
  rundowns,
  value,
  onChange,
}: {
  rundowns: RundownDto[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <SelectField
      label="Escaleta"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={rundowns.map((r) => ({
        value: r.id,
        label: `${r.airDate.slice(8, 10)}/${r.airDate.slice(5, 7)} ${r.startTime.slice(0, 5)} · ${r.title}${
          r.status === 'en_aire' ? ' · EN EL AIRE' : ''
        }`,
      }))}
    />
  );
}
