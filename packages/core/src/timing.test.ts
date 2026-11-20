import { describe, expect, it } from 'vitest';
import {
  autoAdvanceAt,
  computeTiming,
  hasAutonext,
  initialLiveState,
  resolveNext,
  rundownWindow,
  scheduledEvent,
  zonedToEpoch,
  type LiveState,
  type TimingLine,
} from './timing';

const T0 = Date.UTC(2026, 10, 20, 13, 0, 0); // 14:00 en Madrid (invierno, UTC+1)
const win = { plannedStart: T0, plannedEnd: T0 + 60 * 60_000, dayStart: T0 - 14 * 3600_000 };
const sec = (n: number) => n * 1000;

const lines: TimingLine[] = [
  { id: 'a', cells: { nombre: 'Presentación', tipo: 'ACTING', t_est: 30 } },
  { id: 'b', cells: { nombre: 'VTR', tipo: 'VTR', dur_vtr: 70, coleo: 5 } },
  { id: 'c', cells: { nombre: 'Reserva', tipo: 'VARIOS', t_est: 120, _float: '1' } },
  { id: 'd', cells: { nombre: 'Tema', tipo: 'TEMA', t_est: 240 } },
  { id: 'e', cells: { nombre: 'Colas', tipo: 'COLAS', dur_vtr: 40 } },
];

function live(patch: Partial<LiveState> = {}): LiveState {
  return { ...initialLiveState(), ...patch };
}

describe('zonas horarias', () => {
  it('convierte hora local de Madrid a epoch (invierno y verano)', () => {
    expect(zonedToEpoch('2026-11-20', '14:00:00', 'Europe/Madrid')).toBe(
      Date.UTC(2026, 10, 20, 13),
    );
    expect(zonedToEpoch('2026-07-01', '14:00:00', 'Europe/Madrid')).toBe(Date.UTC(2026, 6, 1, 12));
  });

  it('la ventana cruza medianoche si el fin es anterior al inicio', () => {
    const w = rundownWindow('2026-11-20', '23:30:00', '00:30:00', 'Europe/Madrid');
    expect(w.plannedEnd - w.plannedStart).toBe(60 * 60_000);
    expect(w.dayStart).toBe(Date.UTC(2026, 10, 19, 23));
  });
});

describe('antes de empezar', () => {
  it('encadena las horas desde el inicio programado, sin contar flotantes', () => {
    const t = computeTiming(lines, win, live(), T0 - sec(600));
    expect(t.lines.get('a')!.start).toBe(T0);
    expect(t.lines.get('b')!.start).toBe(T0 + sec(30));
    expect(t.lines.get('d')!.start).toBe(T0 + sec(100));
    expect(t.lines.get('e')!.start).toBe(T0 + sec(340));
    expect(t.lines.get('c')!.state).toBe('floating');
    expect(t.totalEstimated).toBe(380);
    expect(t.projectedEnd).toBe(T0 + sec(380));
    expect(t.overUnder).toBe(380 - 3600);
    expect(t.nextLineId).toBe('a');
  });

  it('back-time: cuándo debe empezar cada línea para acabar en hora', () => {
    const t = computeTiming(lines, win, live(), T0);
    expect(t.lines.get('e')!.backTime).toBe(win.plannedEnd - sec(40));
    expect(t.lines.get('d')!.backTime).toBe(win.plannedEnd - sec(280));
    expect(t.lines.get('a')!.backTime).toBe(win.plannedEnd - sec(380));
  });

  it('sumatorio de VTR', () => {
    const t = computeTiming(lines, win, live(), T0);
    expect(t.lines.get('b')!.vtrSum).toBe(70);
    expect(t.lines.get('e')!.vtrSum).toBe(110);
  });

  it('si vamos tarde, proyecta desde ahora', () => {
    const t = computeTiming(lines, win, live(), T0 + sec(60));
    expect(t.lines.get('a')!.start).toBe(T0 + sec(60));
    expect(t.overUnder).toBe(380 + 60 - 3600);
  });
});

describe('en directo', () => {
  const started = live({
    showStartedAt: T0 + sec(5),
    onAir: { lineId: 'b', startedAt: T0 + sec(40) },
    played: { a: { startedAt: T0 + sec(5), duration: 35 } },
  });

  it('usa las horas reales de lo emitido y encadena el resto', () => {
    const t = computeTiming(lines, win, started, T0 + sec(60));
    expect(t.lines.get('a')).toMatchObject({ state: 'played', start: T0 + sec(5), actual: 35 });
    expect(t.lines.get('b')).toMatchObject({ state: 'onAir', start: T0 + sec(40), actual: 20 });
    expect(t.lines.get('d')).toMatchObject({ state: 'next', start: T0 + sec(110) });
    expect(t.lines.get('e')!.start).toBe(T0 + sec(350));
    expect(t.overUnder).toBe(390 - 3600);
  });

  it('si la línea en aire se pasa, empuja a las siguientes', () => {
    const t = computeTiming(lines, win, started, T0 + sec(40 + 100));
    expect(t.lines.get('b')!.actual).toBe(100);
    expect(t.lines.get('d')!.start).toBe(T0 + sec(140));
  });

  it('la siguiente puede elegirse a mano', () => {
    expect(resolveNext(lines, { ...started, next: 'e' })).toBe('e');
    expect(resolveNext(lines, { ...started, next: 'c' })).toBe('d'); // flotante: no
    expect(resolveNext(lines, { ...started, next: 'zzz' })).toBe('d');
  });

  it('al final no hay siguiente', () => {
    expect(resolveNext(lines, live({ onAir: { lineId: 'e', startedAt: T0 } }))).toBeNull();
  });
});

describe('avance automático', () => {
  it('autonext según el modo y el tipo', () => {
    expect(hasAutonext(lines[1]!, 'hibrido')).toBe(true); // VTR
    expect(hasAutonext(lines[0]!, 'hibrido')).toBe(false); // ACTING
    expect(hasAutonext(lines[0]!, 'automatico')).toBe(true);
    expect(hasAutonext(lines[1]!, 'manual')).toBe(false);
    expect(
      hasAutonext({ id: 'x', cells: { tipo: 'ACTING', t_est: 10, _auto: '1' } }, 'hibrido'),
    ).toBe(true);
    expect(
      hasAutonext({ id: 'x', cells: { tipo: 'VTR', dur_vtr: 10, _auto: '0' } }, 'hibrido'),
    ).toBe(false);
  });

  it('el VTR pasa al terminar su duración o su coleo', () => {
    const l = live({ onAir: { lineId: 'b', startedAt: T0 } });
    expect(autoAdvanceAt(lines, l)).toBe(T0 + sec(70));
    expect(autoAdvanceAt(lines, { ...l, autonextAt: 'coleo' })).toBe(T0 + sec(75));
    expect(autoAdvanceAt(lines, { ...l, mode: 'manual' })).toBeNull();
  });

  it('modo evento: arranca a la hora y respeta las horas fijas', () => {
    const withHard: TimingLine[] = [
      ...lines.slice(0, 4),
      { id: 'e', cells: { nombre: 'Conexión', tipo: 'FIBRA', t_est: 60, _hard: '14:30:00' } },
    ];
    const notStarted = live({ mode: 'evento' });
    expect(scheduledEvent(withHard, notStarted, win)).toEqual({ at: T0, lineId: null });
    const running = live({
      mode: 'evento',
      showStartedAt: T0,
      onAir: { lineId: 'a', startedAt: T0 },
    });
    expect(scheduledEvent(withHard, running, win)).toEqual({ at: T0 + 30 * 60_000, lineId: 'e' });
    const t = computeTiming(withHard, win, running, T0 + sec(1));
    expect(t.lines.get('e')!.start).toBe(T0 + 30 * 60_000);
  });
});
