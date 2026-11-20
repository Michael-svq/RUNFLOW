import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  initialMixerState,
  lineSource,
  mapSource,
  MIXER_KINDS,
  parseDeviceConfig,
  type AtemConfig,
  type DeviceKind,
  type DeviceStatus,
  type LiveState,
  type MixerState,
  type ObsConfig,
  type VmixConfig,
} from '@runflow/core';
import { readLines } from '@runflow/sync';
import { devices, withTenant, type Db } from '@runflow/db';
import type { CollabServer } from '../collab/collab-server';
import { AtemDriver } from './atem';
import type { MixerDriver } from './driver';
import { ObsDriver } from './obs';
import { VmixDriver } from './vmix';

/*
 * Mezcladores (PLAN §11 y M8): con GO, el mezclador corta a la FUENTE de la
 * línea en aire (CAM 1, VTR, EXT 1…) según el mapa de fuentes de cada equipo.
 * Desarmado o en ensayo no se mueve nada; si un mezclador falla, aviso y sigue.
 */

export const MSG_MIXER = 106;
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

interface Mixer {
  id: string;
  name: string;
  kind: DeviceKind;
  sources: Record<string, string>;
  driver: MixerDriver;
}

interface RundownMixer {
  orgId: string;
  state: MixerState;
  queue: Promise<unknown>;
}

export function createDriver(kind: DeviceKind, config: unknown): MixerDriver | null {
  const parsed = parseDeviceConfig(kind, config);
  if (!parsed) return null;
  if (kind === 'obs') return new ObsDriver(parsed as ObsConfig);
  if (kind === 'vmix') return new VmixDriver(parsed as VmixConfig);
  if (kind === 'atem') return new AtemDriver(parsed as AtemConfig);
  return null;
}

export class MixerManager {
  private readonly orgs = new Map<string, Promise<Mixer[]>>();
  private readonly rundowns = new Map<string, RundownMixer>();

  constructor(
    private readonly db: Db,
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
  ) {
    collab.snapshots.push(async (rundownId, orgId) => ({
      type: MSG_MIXER,
      payload: await this.snapshot(rundownId, orgId),
    }));
  }

  private org(orgId: string): Promise<Mixer[]> {
    let entry = this.orgs.get(orgId);
    if (!entry) {
      entry = this.load(orgId);
      this.orgs.set(orgId, entry);
      entry.catch(() => this.orgs.delete(orgId));
    }
    return entry;
  }

  private async load(orgId: string): Promise<Mixer[]> {
    const rows = await withTenant(this.db, { orgId, userId: SYSTEM_USER }, (tx) =>
      tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.orgId, orgId),
            eq(devices.enabled, true),
            inArray(devices.kind, MIXER_KINDS),
          ),
        ),
    );
    const list: Mixer[] = [];
    for (const row of rows) {
      const kind = row.kind as DeviceKind;
      const driver = createDriver(kind, row.config);
      if (!driver) continue;
      const config = parseDeviceConfig(kind, row.config) as { sources: Record<string, string> };
      driver.on('status', () => this.onStatus(orgId));
      driver.connect();
      list.push({ id: row.id, name: row.name, kind, sources: config.sources, driver });
    }
    return list;
  }

  async invalidate(orgId: string): Promise<void> {
    const entry = this.orgs.get(orgId);
    this.orgs.delete(orgId);
    for (const m of (await entry?.catch(() => [])) ?? []) m.driver.close();
    if ([...this.rundowns.values()].some((r) => r.orgId === orgId)) this.onStatus(orgId);
  }

  async deviceStatuses(orgId: string): Promise<Record<string, DeviceStatus>> {
    const list = await this.org(orgId);
    return Object.fromEntries(list.map((m) => [m.id, this.status(m)]));
  }

  private status(m: Mixer): DeviceStatus {
    return {
      connected: m.driver.connected,
      error: m.driver.connected ? null : m.driver.lastError,
      version: m.driver.version,
    };
  }

  private deviceMap(list: Mixer[]): MixerState['devices'] {
    return Object.fromEntries(
      list.map((m) => [m.id, { ...this.status(m), name: m.name, kind: m.kind }]),
    );
  }

  private onStatus(orgId: string): void {
    void this.orgs.get(orgId)?.then((list) => {
      for (const [rundownId, rm] of this.rundowns) {
        if (rm.orgId !== orgId) continue;
        rm.state.devices = this.deviceMap(list);
        this.collab.broadcastCustom(rundownId, MSG_MIXER, rm.state);
      }
    });
  }

  async snapshot(rundownId: string, orgId: string): Promise<MixerState> {
    const list = await this.org(orgId);
    const rm = this.rundowns.get(rundownId);
    const base = rm && rm.orgId === orgId ? rm.state : initialMixerState();
    return { ...base, devices: this.deviceMap(list) };
  }

  /** Entradas o escenas de un mezclador (para el mapa de fuentes). */
  async inputs(orgId: string, deviceId: string): Promise<string[]> {
    const m = (await this.org(orgId)).find((x) => x.id === deviceId);
    if (!m) return [];
    return m.driver.inputs();
  }

  /** Prueba de conexión (Configuración). */
  static async test(
    kind: DeviceKind,
    config: unknown,
  ): Promise<{ version: string; inputs: number }> {
    const driver = createDriver(kind, config);
    if (!driver) throw new Error('Configuración no válida');
    try {
      driver.connect();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(driver.lastError ?? 'No responde')), 4000);
        const check = () => {
          if (driver.connected) {
            clearTimeout(timer);
            resolve();
          } else if (driver.lastError) {
            clearTimeout(timer);
            reject(new Error(driver.lastError));
          }
        };
        driver.on('status', check);
      });
      const inputs = await driver.inputs().catch(() => []);
      return { version: driver.version ?? '', inputs: inputs.length };
    } finally {
      driver.close();
    }
  }

  /** Lo llama el motor de directo tras cada cambio. */
  onLive(rundownId: string, orgId: string, prev: LiveState, next: LiveState, goAt?: number): void {
    const changed =
      prev.onAir?.lineId !== next.onAir?.lineId || prev.onAir?.startedAt !== next.onAir?.startedAt;
    if (!changed) return;
    let rm = this.rundowns.get(rundownId);
    if (!rm || rm.orgId !== orgId) {
      rm = { orgId, state: initialMixerState(), queue: Promise.resolve() };
      this.rundowns.set(rundownId, rm);
    }
    const r = rm;
    const start = goAt ?? Date.now();
    const run = r.queue.then(() => this.cut(rundownId, r, next, start));
    r.queue = run.catch((err: unknown) => this.log.error({ err, rundownId }, 'Mezcladores: error'));
  }

  private async cut(
    rundownId: string,
    rm: RundownMixer,
    live: LiveState,
    start: number,
  ): Promise<void> {
    const list = await this.org(rm.orgId);
    rm.state.devices = this.deviceMap(list);
    const onAirId = live.onAir?.lineId;
    if (!onAirId) {
      rm.state.program = null;
      this.collab.broadcastCustom(rundownId, MSG_MIXER, rm.state);
      return;
    }
    const line = await this.collab.withDoc(rundownId, rm.orgId, (doc) =>
      readLines(doc).find((l) => l.id === onAirId),
    );
    const source = line ? lineSource(line.cells) : null;
    const inputs: Record<string, string> = {};
    for (const m of list) {
      const input = mapSource(m.sources, source);
      if (input) inputs[m.id] = input;
    }
    rm.state.program = source ? { lineId: onAirId, source, inputs } : null;
    if (live.armed && !live.rehearsal && Object.keys(inputs).length) {
      const results = await Promise.allSettled(
        list.filter((m) => inputs[m.id]).map((m) => m.driver.cut(inputs[m.id]!)),
      );
      const failed = results
        .map((res, i) =>
          res.status === 'rejected'
            ? `${list.filter((m) => inputs[m.id])[i]!.name}: ${(res.reason as Error).message}`
            : null,
        )
        .filter(Boolean);
      rm.state.warning = failed.length ? failed.join(' · ') : null;
      rm.state.lastCutMs = Date.now() - start;
      if (failed.length) this.log.warn({ rundownId, failed }, 'Mezclador sin respuesta');
    }
    this.collab.broadcastCustom(rundownId, MSG_MIXER, rm.state);
  }

  close(): void {
    this.rundowns.clear();
    for (const entry of this.orgs.values()) {
      void entry.then((list) => list.forEach((m) => m.driver.close())).catch(() => undefined);
    }
    this.orgs.clear();
  }
}
