import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  cameraConfigSchema,
  DEFAULT_CAMERA_IMAGE,
  type CameraConfig,
  type CameraDto,
  type CameraImage,
  type CameraMove,
  type CameraState,
  type DeviceStatus,
} from '@runflow/core';
import { devices, withSystem, type Db } from '@runflow/db';
import { HttpError, notFound } from '../errors';
import { assertPublicUrl } from '../sources/feed';
import { createDriver, type CameraDriver } from './drivers';

/*
 * Cámaras PTZ de cada empresa (equipos de tipo «camera»): órdenes de
 * movimiento, posiciones, imagen, balances y foco, con el último estado
 * conocido de cada una.
 */

interface Cam {
  id: string;
  name: string;
  config: CameraConfig;
  driver: CameraDriver;
  state: CameraState;
  connected: boolean;
  error: string | null;
  probedAt: number;
}

const PROBE_EVERY_MS = 20_000;

export class CameraManager {
  private readonly orgs = new Map<string, Promise<Cam[]>>();

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { allowPrivate: boolean },
  ) {}

  private org(orgId: string): Promise<Cam[]> {
    let entry = this.orgs.get(orgId);
    if (!entry) {
      entry = withSystem(this.db, (tx) =>
        tx
          .select()
          .from(devices)
          .where(
            and(eq(devices.orgId, orgId), eq(devices.kind, 'camera'), eq(devices.enabled, true)),
          ),
      ).then((rows) =>
        rows.flatMap((r) => {
          const parsed = cameraConfigSchema.safeParse(r.config);
          if (!parsed.success) return [];
          const cam: Cam = {
            id: r.id,
            name: r.name,
            config: parsed.data,
            driver: createDriver(parsed.data, this.opts),
            state: {
              image: { ...DEFAULT_CAMERA_IMAGE },
              focusAuto: true,
              presets: [],
              whiteBalancedAt: null,
              blackBalancedAt: null,
            },
            connected: parsed.data.protocol === 'simulated',
            error: null,
            probedAt: 0,
          };
          return [cam];
        }),
      );
      this.orgs.set(orgId, entry);
      entry.catch(() => this.orgs.delete(orgId));
    }
    return entry;
  }

  /** Comprueba (sin esperar) las cámaras que hace rato que no responden. */
  private probe(cams: Cam[]): void {
    const now = Date.now();
    for (const c of cams) {
      if (c.config.protocol === 'simulated' || now - c.probedAt < PROBE_EVERY_MS) continue;
      c.probedAt = now;
      c.driver
        .probe()
        .then(() => {
          c.connected = true;
          c.error = null;
        })
        .catch((err: unknown) => {
          c.connected = false;
          c.error = err instanceof Error ? err.message : String(err);
        });
    }
  }

  private dto(c: Cam): CameraDto {
    return {
      id: c.id,
      name: c.name,
      protocol: c.config.protocol,
      connected: c.connected,
      error: c.error,
      snapshot: !!c.driver.snapshot || !!c.config.snapshotUrl,
      state: c.state,
    };
  }

  async list(orgId: string): Promise<CameraDto[]> {
    const cams = await this.org(orgId);
    this.probe(cams);
    return cams.map((c) => this.dto(c));
  }

  private async cam(orgId: string, id: string): Promise<Cam> {
    const c = (await this.org(orgId)).find((x) => x.id === id);
    if (!c) throw notFound('Cámara no encontrada');
    return c;
  }

  /** Ejecuta una orden; si la cámara no responde, lo anota y avisa. */
  private async run<T>(c: Cam, what: string, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      if (c.config.protocol !== 'visca') {
        c.connected = true;
        c.error = null;
      }
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      c.error = msg;
      this.log.warn({ camera: c.name, what, err: msg }, 'Cámara');
      throw new HttpError(502, 'camera_error', `${c.name}: ${msg}`);
    }
  }

  async move(orgId: string, id: string, m: CameraMove): Promise<CameraDto> {
    const c = await this.cam(orgId, id);
    await this.run(c, 'move', () => c.driver.move(m));
    return this.dto(c);
  }

  async preset(
    orgId: string,
    id: string,
    action: 'recall' | 'save',
    slot: number,
  ): Promise<CameraDto> {
    const c = await this.cam(orgId, id);
    await this.run(c, 'preset', () => c.driver.preset(action, slot));
    if (action === 'save' && !c.state.presets.includes(slot)) {
      c.state.presets = [...c.state.presets, slot].sort((a, b) => a - b);
    }
    return this.dto(c);
  }

  async image(orgId: string, id: string, patch: Partial<CameraImage>): Promise<CameraDto> {
    const c = await this.cam(orgId, id);
    const full = { ...c.state.image, ...patch };
    await this.run(c, 'image', () => c.driver.image(patch, full));
    c.state.image = full;
    return this.dto(c);
  }

  async balance(orgId: string, id: string, kind: 'white' | 'black'): Promise<CameraDto> {
    const c = await this.cam(orgId, id);
    const result = await this.run(c, 'balance', () => c.driver.balance(kind));
    if (result) c.state.image = { ...c.state.image, ...result };
    if (kind === 'white') c.state.whiteBalancedAt = Date.now();
    else c.state.blackBalancedAt = Date.now();
    return this.dto(c);
  }

  async focus(orgId: string, id: string, mode: 'auto' | 'manual' | 'onepush'): Promise<CameraDto> {
    const c = await this.cam(orgId, id);
    await this.run(c, 'focus', () => c.driver.focus(mode));
    if (mode !== 'onepush') c.state.focusAuto = mode === 'auto';
    return this.dto(c);
  }

  async snapshot(orgId: string, id: string): Promise<{ type: string; body: Buffer | string }> {
    const c = await this.cam(orgId, id);
    if (c.config.snapshotUrl) {
      const url = c.config.snapshotUrl;
      if (!/^https?:\/\//i.test(url))
        throw new HttpError(400, 'invalid_url', 'Dirección no válida');
      if (!this.opts.allowPrivate) await assertPublicUrl(url);
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(4000) });
      if (res.status >= 400) throw new HttpError(502, 'camera_error', `Imagen: ${res.status}`);
      return {
        type: res.headers.get('content-type') ?? 'image/jpeg',
        body: Buffer.from(await res.arrayBuffer()),
      };
    }
    if (!c.driver.snapshot) {
      throw new HttpError(404, 'no_snapshot', 'Esta cámara no da imagen: usa una entrada de vídeo');
    }
    return this.run(c, 'snapshot', () => c.driver.snapshot!());
  }

  async deviceStatuses(orgId: string): Promise<Record<string, DeviceStatus>> {
    const cams = await this.org(orgId);
    this.probe(cams);
    return Object.fromEntries(
      cams.map((c) => [
        c.id,
        { connected: c.connected, error: c.error, version: c.config.protocol.toUpperCase() },
      ]),
    );
  }

  invalidate(orgId: string): void {
    const entry = this.orgs.get(orgId);
    this.orgs.delete(orgId);
    void entry?.then((cams) => cams.forEach((c) => c.driver.close())).catch(() => undefined);
  }

  /** Para la prueba de conexión del formulario de equipos. */
  static async test(
    config: CameraConfig,
    opts: { allowPrivate: boolean },
  ): Promise<{ version: string }> {
    const driver = createDriver(config, opts);
    try {
      return { version: await driver.probe() };
    } finally {
      driver.close();
    }
  }

  close(): void {
    for (const orgId of [...this.orgs.keys()]) this.invalidate(orgId);
  }
}
