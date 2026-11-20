import { describe, expect, it } from 'vitest';
import { formatCueTime, nextCue, parseCueTime, placeCues, type Cue } from './timeline';

describe('timeline', () => {
  it('códigos de tiempo con fotogramas (25 fps)', () => {
    expect(formatCueTime(12.2)).toBe('0:12:05');
    expect(formatCueTime(3725.04)).toBe('1:02:05:01');
    expect(parseCueTime('0:12:05')).toBeCloseTo(12.2);
    expect(parseCueTime('1:02:05:01')).toBeCloseTo(3725.04);
    expect(parseCueTime('1:30')).toBe(90);
    expect(parseCueTime('12,5')).toBe(12.5);
    expect(parseCueTime('0:12:25')).toBeNull();
    expect(parseCueTime('0:61')).toBeNull();
    expect(parseCueTime('abc')).toBeNull();
  });

  it('coloca y ordena los cues en la escaleta', () => {
    const cue = (id: string, track: Cue['track'], at: number): Cue => ({
      id,
      track,
      at,
      duration: 0,
      label: id,
      target: '',
    });
    const placed = placeCues(
      [{ id: 'a' }, { id: 'b' }],
      new Map([
        ['a', 1_000_000],
        ['b', 1_030_000],
      ]),
      new Map([
        ['a', [cue('a2', 'luces', 20), cue('a1', 'camara', 0)]],
        ['b', [cue('b1', 'camara', 0), cue('b0', 'luces', 0)]],
      ]),
    );
    expect(placed.map((c) => c.id)).toEqual(['a1', 'a2', 'b1', 'b0']);
    expect(placed[2]!.absAt).toBe(1_030_000);
    expect(nextCue(placed, 1_010_000)?.id).toBe('a2');
    expect(nextCue(placed, 1_010_000, 'camara')?.id).toBe('b1');
  });
});
