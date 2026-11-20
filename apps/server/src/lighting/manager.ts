import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  LIGHTING_PROTOCOLS,
  lightingConfigSchema,
  parseDmxSpec,
  type DeviceStatus,
  type LightingConfig,
} from '@runflow/core';
import { devices, withSystem, type Db } from '@runflow/db';
import { artDmx, mscGo, oscMessage, sacnMulticast, sacnPacket } from './packets';

/*
 * F4.3 Iluminación: dispara cues en mesas por OSC o MIDI Show Control
 * (ipMIDI) y escenas DMX por Art-Net o sACN (con fundido si el cue dura).
 * Todo va por UDP: no hay confirmación de la mesa, solo errores de envío.
 */

const IPMIDI_GROUP = '225.0.0.37';
const REFRESH_MS = 1000;
const FADE_STEP_MS = 40;

interface Light {
  id: string;
  name: string;
  config: LightingConfig;
  /** Estado DMX del universo (Art-Net / sACN). */
  dmx: Uint8Array;
  seq: number;
  fade?: NodeJS.Timeout;
  refresh?: NodeJS.Timeout;
  lastError: string | null;
  lastSentAt: number | null;
}

const defaultPort = (c: LightingConfig) =>
  c.port || LIGHTING_PROTOCOLS.find((p) => p.value === c.protocol)!.port;

export class LightingManager {
  private readonly orgs = new Map<string, Promise<Light[]>>();
  private readonly socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  private readonly cid = randomBytes(16);
  private ready: Promise<void>;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {
    this.socket.on('error', (err) => this.log.warn({ err }, 'Iluminación: error UDP'));
    this.ready = new Promise((resolve) =>
      this.socket.bind(0, () => {
        try {
          this.socket.setBroadcast(true);
          this.socket.setMulticastTTL(4);
        } catch {
          // sin difusión
        }
        resolve();
      }),
    );
    this.socket.unref();
  }

  private org(orgId: string): Promise<Light[]> {
    let entry = this.orgs.get(orgId);
    if (!entry) {
      entry = withSystem(this.db, (tx) =>
        tx
          .select()
          .from(devices)
          .where(
            and(eq(devices.orgId, orgId), eq(devices.kind, 'lighting'), eq(devices.enabled, true)),
          ),
      ).then((rows) =>
        rows.flatMap((r) => {
          const parsed = lightingConfigSchema.safeParse(r.config);
          return parsed.success
            ? [
                {
                  id: r.id,
                  name: r.name,
                  config: parsed.data,
                  dmx: new Uint8Array(512),
                  seq: 0,
                  lastError: null,
                  lastSentAt: null,
                },
              ]
            : [];
        }),
      );
      this.orgs.set(orgId, entry);
      entry.catch(() => this.orgs.delete(orgId));
    }
    return entry;
  }

  async invalidate(orgId: string): Promise<void> {
    const entry = this.orgs.get(orgId);
    this.orgs.delete(orgId);
    const list = await entry?.catch(() => []);
    for (const l of list ?? []) this.stopTimers(l);
  }

  async deviceStatuses(orgId: string): Promise<Record<string, DeviceStatus>> {
    const list = await this.org(orgId);
    return Object.fromEntries(
      list.map((l) => [
        l.id,
        {
          connected: !l.lastError,
          error: l.lastError,
          version: l.lastSentAt ? 'UDP' : null,
        },
      ]),
    );
  }

  private async send(l: Light, data: Buffer, host: string): Promise<void> {
    await this.ready;
    await new Promise<void>((resolve, reject) =>
      this.socket.send(data, defaultPort(l.config), host, (err) => (err ? reject(err) : resolve())),
    );
    l.lastSentAt = Date.now();
    l.lastError = null;
  }

  private dmxHost(l: Light): string {
    const c = l.config;
    if (c.host) return c.host;
    return c.protocol === 'sacn' ? sacnMulticast(c.universe) : '255.255.255.255';
  }

  private sendDmx(l: Light): Promise<void> {
    l.seq = (l.seq + 1) & 0xff;
    const packet =
      l.config.protocol === 'artnet'
        ? artDmx(l.config.universe, l.seq || 1, l.dmx)
        : sacnPacket(l.config.universe, l.seq, l.dmx, { cid: this.cid, sourceName: 'RunFlow' });
    return this.send(l, packet, this.dmxHost(l));
  }

  private stopTimers(l: Light): void {
    clearInterval(l.fade);
    clearInterval(l.refresh);
    l.fade = undefined;
    l.refresh = undefined;
  }

  /** Las mesas DMX esperan el universo cada poco (sACN da la fuente por perdida a los 2,5 s). */
  private keepAlive(l: Light): void {
    if (l.refresh) return;
    l.refresh = setInterval(() => void this.sendDmx(l).catch(() => undefined), REFRESH_MS);
    l.refresh.unref?.();
  }

  /** Aplica canales DMX, con fundido si `seconds` > 0. */
  private async applyDmx(l: Light, channels: Map<number, number>, seconds: number): Promise<void> {
    clearInterval(l.fade);
    const from = new Map([...channels.keys()].map((c) => [c, l.dmx[c - 1]!]));
    if (seconds <= 0) {
      for (const [c, v] of channels) l.dmx[c - 1] = v;
      await this.sendDmx(l);
    } else {
      const start = Date.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const k = Math.min(1, (Date.now() - start) / (seconds * 1000));
          for (const [c, v] of channels)
            l.dmx[c - 1] = Math.round(from.get(c)! + (v - from.get(c)!) * k);
          void this.sendDmx(l).catch(() => undefined);
          if (k >= 1) {
            clearInterval(l.fade);
            resolve();
          }
        };
        l.fade = setInterval(step, FADE_STEP_MS);
        step();
      });
    }
    this.keepAlive(l);
  }

  private async fireOne(l: Light, target: string, seconds: number): Promise<void> {
    const c = l.config;
    try {
      if (c.protocol === 'osc') {
        const address = c.oscAddress.replaceAll('{cue}', target);
        const args = c.oscArg ? [c.oscArg.replaceAll('{cue}', target)] : [];
        if (!c.host) throw new Error('Falta la dirección de la mesa');
        await this.send(l, oscMessage(address, args), c.host);
      } else if (c.protocol === 'msc') {
        if (!/\d/.test(target)) throw new Error(`«${target}» no es un número de cue`);
        await this.send(l, mscGo(c.mscDevice, target, c.mscList), c.host || IPMIDI_GROUP);
      } else {
        const channels = parseDmxSpec(target, c.presets);
        if (!channels) throw new Error(`«${target}» no es una escena ni canales DMX (1=255,…)`);
        await this.applyDmx(l, channels, seconds);
      }
    } catch (err) {
      l.lastError = err instanceof Error ? err.message : String(err);
      throw new Error(`${l.name}: ${l.lastError}`);
    }
  }

  /** Dispara un cue en todas las mesas de la empresa (o en una). Devuelve en cuántas. */
  async fire(orgId: string, target: string, seconds = 0, deviceId?: string): Promise<number> {
    const t = target.trim();
    if (!t) throw new Error('El cue de luces no dice qué disparar');
    const list = (await this.org(orgId)).filter((l) => !deviceId || l.id === deviceId);
    if (!list.length) return 0;
    const results = await Promise.allSettled(list.map((l) => this.fireOne(l, t, seconds)));
    const failed = results.flatMap((r) =>
      r.status === 'rejected' ? [(r.reason as Error).message] : [],
    );
    if (failed.length === list.length) throw new Error(failed.join(' · '));
    return list.length - failed.length;
  }

  /** Prueba de configuración (no hay respuesta en UDP: se comprueba que se puede enviar). */
  static async test(config: LightingConfig): Promise<{ version: string }> {
    if ((config.protocol === 'osc' || config.protocol === 'artnet') && !config.host)
      throw new Error('Indica la dirección IP');
    const sock = dgram.createSocket('udp4');
    try {
      await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(0, () => resolve());
      });
      return { version: 'UDP listo (las mesas no confirman: prueba un cue)' };
    } finally {
      sock.close();
    }
  }

  close(): void {
    for (const entry of this.orgs.values())
      void entry.then((list) => list.forEach((l) => this.stopTimers(l))).catch(() => undefined);
    this.orgs.clear();
    try {
      this.socket.close();
    } catch {
      // ya cerrado
    }
  }
}
