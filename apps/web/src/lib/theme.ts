import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'interior' | 'exterior';
const KEY = 'rf-theme';
const listeners = new Set<() => void>();

function read(): Theme {
  const current = document.documentElement.dataset.theme;
  return current === 'exterior' ? 'exterior' : 'interior';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Sin almacenamiento (modo privado): el tema dura hasta recargar.
  }
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'interior' as Theme,
  );
  return [theme, useCallback(setTheme, [])];
}
