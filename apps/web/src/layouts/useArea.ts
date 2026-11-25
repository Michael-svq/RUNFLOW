import { useSyncExternalStore } from 'react';
import { useMe } from '../auth/session';
import { allowedAreas, type Area, type AreaKey } from './areas';

/* Área de trabajo actual, recordada en este navegador y compartida por toda la app. */

const KEY = 'rf-area';
const listeners = new Set<() => void>();

function read(): AreaKey | null {
  try {
    return localStorage.getItem(KEY) as AreaKey | null;
  } catch {
    return null;
  }
}
let memory: AreaKey | null = null;

export function setArea(key: AreaKey): void {
  memory = key;
  try {
    localStorage.setItem(KEY, key);
  } catch {
    // sin almacenamiento
  }
  listeners.forEach((l) => l());
}

export function useArea(): { allowed: Area[]; current: Area | null; set: (k: AreaKey) => void } {
  const { data: me } = useMe();
  const stored = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => memory ?? read(),
    () => null,
  );
  const allowed = allowedAreas(me?.activeOrg?.permissions ?? []);
  const current = allowed.find((a) => a.key === stored) ?? allowed[0] ?? null;
  return { allowed, current, set: setArea };
}
