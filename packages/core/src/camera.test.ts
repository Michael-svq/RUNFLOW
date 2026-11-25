import { describe, expect, it } from 'vitest';
import {
  autoStep,
  DEFAULT_CAMERA_AUTO,
  DEFAULT_CAMERA_IMAGE,
  type CameraImage,
  type SignalStats,
} from './camera';
import { deviceInput, readOrgSettings } from './cg';

const stats = (s: Partial<SignalStats>): SignalStats => ({
  luma: 45,
  clipHigh: 0,
  clipLow: 0,
  castR: 0,
  castB: 0,
  neutralShare: 10,
  ...s,
});
const img = (i: Partial<CameraImage> = {}): CameraImage => ({ ...DEFAULT_CAMERA_IMAGE, ...i });

describe('control automático de la señal', () => {
  it('dentro de los objetivos no toca nada', () => {
    expect(autoStep(stats({ luma: 46 }), img(), DEFAULT_CAMERA_AUTO)).toBeNull();
  });

  it('oscura: abre el diafragma y, abierto, sube la ganancia hasta el máximo', () => {
    const a = autoStep(stats({ luma: 25 }), img({ iris: 50 }), DEFAULT_CAMERA_AUTO)!;
    expect(a.patch.iris).toBe(62);
    expect(a.reason).toMatch(/abre el diafragma/);
    const b = autoStep(stats({ luma: 25 }), img({ iris: 100 }), DEFAULT_CAMERA_AUTO)!;
    expect(b.patch.gainDb).toBe(6);
    const c = autoStep(stats({ luma: 25 }), img({ iris: 100, gainDb: 12 }), DEFAULT_CAMERA_AUTO)!;
    expect(c.patch).toEqual({});
    expect(c.reason).toMatch(/falta luz/);
  });

  it('quemada: baja primero la ganancia y luego cierra', () => {
    const a = autoStep(stats({ luma: 47, clipHigh: 8 }), img({ gainDb: 9 }), DEFAULT_CAMERA_AUTO)!;
    expect(a.patch.gainDb).toBe(6);
    const b = autoStep(stats({ luma: 70 }), img({ iris: 80 }), DEFAULT_CAMERA_AUTO)!;
    expect(b.patch.iris).toBe(65);
    expect(b.reason).toMatch(/cierra el diafragma/);
  });

  it('corrige la dominante de color con zonas neutras', () => {
    const a = autoStep(stats({ castR: 10, castB: -6 }), img(), DEFAULT_CAMERA_AUTO)!;
    expect(a.patch).toEqual({ rGain: -5, bGain: 3 });
    // Sin zonas neutras no se toca el color.
    expect(autoStep(stats({ castR: 10, neutralShare: 0 }), img(), DEFAULT_CAMERA_AUTO)).toBeNull();
    expect(
      autoStep(stats({ castR: 10 }), img(), { ...DEFAULT_CAMERA_AUTO, whiteBalance: false }),
    ).toBeNull();
  });

  it('cámaras como equipos y memorias en la configuración', () => {
    const d = deviceInput.parse({ name: 'CAM 1', kind: 'camera', config: { host: '10.0.0.5' } });
    expect(d.config).toMatchObject({ protocol: 'visca', port: 0, address: 1 });
    const s = readOrgSettings({
      cameraProfiles: [{ id: 'p1', name: 'Plató día', image: DEFAULT_CAMERA_IMAGE }],
    });
    expect(s.cameraProfiles[0]!.auto.lumaTarget).toBe(45);
    expect(readOrgSettings({}).cameraProfiles).toEqual([]);
  });
});
