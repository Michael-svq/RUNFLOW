import { useEffect, useState } from 'react';

/*
 * Reloj común: todos los relojes de RunFlow usan la hora del servidor
 * (corregida con el desfase de este equipo), como hace NTP.
 */

let offset = 0;
let lastSync = 0;
let syncing: Promise<void> | null = null;

async function sample(): Promise<{ offset: number; rtt: number }> {
  const t0 = performance.now();
  const wall0 = Date.now();
  const res = await fetch('/api/time', { cache: 'no-store' });
  const { now } = (await res.json()) as { now: number };
  const rtt = performance.now() - t0;
  return { offset: now + rtt / 2 - (wall0 + rtt), rtt };
}

/** Sincroniza con el servidor (varias muestras; se queda con la de menor latencia). */
export function syncClock(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const samples = [];
      for (let i = 0; i < 4; i++) samples.push(await sample());
      const best = samples.sort((a, b) => a.rtt - b.rtt)[0]!;
      offset = best.offset;
      lastSync = Date.now();
    } catch {
      // Sin red: se mantiene el último desfase conocido.
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Hora del servidor (ms epoch). */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Hora del servidor que se actualiza cada `intervalMs`. */
export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (Date.now() - lastSync > 5 * 60_000) void syncClock();
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    const resync = setInterval(() => void syncClock(), 5 * 60_000);
    return () => {
      clearInterval(id);
      clearInterval(resync);
    };
  }, [intervalMs]);
  return now;
}
