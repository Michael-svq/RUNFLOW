import { describe, expect, it } from 'vitest';
import { currentBlockClock, initialLiveState, rundownBlocks, type TimingLine } from './timing';

const l = (id: string, cells: Record<string, string | number>): TimingLine => ({ id, cells });

describe('bloques', () => {
  const lines = [
    l('a', { nombre: 'Cabecera', t_est: 20 }),
    l('b', { nombre: 'HEADLINES 1', t_est: 30, _block: '1' }),
    l('c', { nombre: 'Tema', t_est: 60 }),
    l('d', { nombre: 'Reserva', t_est: 45, _float: '1' }),
    l('e', { nombre: 'BLOQUE 2', t_est: 10, _block: '1' }),
    l('f', { nombre: 'Tiempo', dur_vtr: 50 }),
  ];

  it('agrupa las líneas hasta el siguiente inicio y suma sus tiempos sin flotantes', () => {
    expect(rundownBlocks(lines)).toEqual([
      { id: 'b', name: 'HEADLINES 1', lineIds: ['b', 'c', 'd'], plannedSeconds: 90 },
      { id: 'e', name: 'BLOQUE 2', lineIds: ['e', 'f'], plannedSeconds: 60 },
    ]);
  });

  it('cuenta desde la primera línea del bloque que salió', () => {
    const live = {
      ...initialLiveState(),
      onAir: { lineId: 'c', startedAt: 100_000 },
      played: { b: { startedAt: 70_000, duration: 30 } },
    };
    const clock = currentBlockClock(lines, live, 130_000)!;
    expect(clock.block.name).toBe('HEADLINES 1');
    expect(clock.elapsed).toBe(60);
    expect(clock.remaining).toBe(30);
    // Fuera de un bloque no hay reloj de bloque.
    expect(
      currentBlockClock(lines, { ...live, onAir: { lineId: 'a', startedAt: 0 } }, 10_000),
    ).toBeNull();
  });
});
