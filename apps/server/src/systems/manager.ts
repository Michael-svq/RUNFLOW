import dgram from 'node:dgram';
import net from 'node:net';
import { and, eq } from 'drizzle-orm';
import {
  fillTemplate,
  genericConfigSchema,
  type CueTrack,
  type DeviceStatus,
  type GenericConfig,
} from '@runflow/core';
import { devices, withSystem, type Db } from '@runflow/db';
import { assertPublicUrl } from '../sources/feed';
import { oscMessage } from '../lighting/packets';

/*
 * F4.4 Otros sistemas: conector genérico para lo que no tiene driver propio
 * (TriCaster por HTTP, Ross/XPression por RossTalk en TCP, automatismos por
 * UDP u OSC…). Cada sistema recibe los cues de las pistas del timeline que
 * tenga asignadas, con plantillas {cue}, {label}, {target} y {track}.
 */

interface System {
  id: string;
  name: string;
  config: GenericConfig;
  lastError: string | null;
  lastSentAt: number | null;
}

export interface CueVars {
  cue: string;
  label: string;
  target: string;
  track: string;
}

const EOL = { crlf: '\r\n', lf: '\n', none: '' } as const;
const TIMEOUT_MS = 4000;

export async function sendGeneric(
  config: GenericConfig,
  vars: CueVars,
  opts: { allowPrivate: boolean },
): Promise<void> {
  switch (config.protocol) {
    case 'http': {
      const url = fillTemplate(config.url, vars, encodeURIComponent);
      if (!/^https?:\/\//i.test(url)) throw new Error('Dirección HTTP no válida');
      if (!opts.allowPrivate) await assertPublicUrl(url);
      const res = await fetch(url, {
        method: config.method,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(config.method === 'POST'
          ? {
              body: fillTemplate(config.body, vars),
              headers: {
                'content-type': config.body.trim().startsWith('{')
                  ? 'application/json'
                  : 'text/plain; charset=utf-8',
              },
            }
          : {}),
      });
      if (res.status >= 400) throw new Error(`Respondió ${res.status}`);
      return;
    }
    case 'tcp': {
      if (!config.host || !config.port) throw new Error('Falta la dirección o el puerto');
      const text = fillTemplate(config.command, vars) + EOL[config.lineEnding];
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect({ host: config.host, port: config.port });
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error('Sin respuesta (tiempo agotado)'));
        }, TIMEOUT_MS);
        sock.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        sock.once('connect', () =>
          sock.end(text, () => {
            clearTimeout(timer);
            resolve();
          }),
        );
      });
      return;
    }
    case 'udp':
    case 'osc': {
      if (!config.host || !config.port) throw new Error('Falta la dirección o el puerto');
      const data =
        config.protocol === 'osc'
          ? oscMessage(
              fillTemplate(config.oscAddress, vars),
              config.oscArg ? [fillTemplate(config.oscArg, vars)] : [],
            )
          : Buffer.from(fillTemplate(config.command, vars) + EOL[config.lineEnding], 'utf8');
      const sock = dgram.createSocket('udp4');
      try {
        await new Promise<void>((resolve, reject) =>
          sock.send(data, config.port, config.host, (err) => (err ? reject(err) : resolve())),
        );
      } finally {
        sock.close();
      }
      return;
    }
  }
}

export class SystemsManager {
  private readonly orgs = new Map<string, Promise<System[]>>();

  constructor(
    private readonly db: Db,
    private readonly opts: { allowPrivate: boolean },
  ) {}

  private org(orgId: string): Promise<System[]> {
    let entry = this.orgs.get(orgId);
    if (!entry) {
      entry = withSystem(this.db, (tx) =>
        tx
          .select()
          .from(devices)
          .where(
            and(eq(devices.orgId, orgId), eq(devices.kind, 'generic'), eq(devices.enabled, true)),
          ),
      ).then((rows) =>
        rows.flatMap((r) => {
          const parsed = genericConfigSchema.safeParse(r.config);
          return parsed.success
            ? [{ id: r.id, name: r.name, config: parsed.data, lastError: null, lastSentAt: null }]
            : [];
        }),
      );
      this.orgs.set(orgId, entry);
      entry.catch(() => this.orgs.delete(orgId));
    }
    return entry;
  }

  invalidate(orgId: string): void {
    this.orgs.delete(orgId);
  }

  async deviceStatuses(orgId: string): Promise<Record<string, DeviceStatus>> {
    const list = await this.org(orgId);
    return Object.fromEntries(
      list.map((s) => [
        s.id,
        {
          connected: !s.lastError,
          error: s.lastError,
          version: s.lastSentAt ? s.config.protocol.toUpperCase() : null,
        },
      ]),
    );
  }

  private async sendOne(s: System, vars: CueVars): Promise<void> {
    try {
      await sendGeneric(s.config, vars, this.opts);
      s.lastError = null;
      s.lastSentAt = Date.now();
    } catch (err) {
      s.lastError = err instanceof Error ? err.message : String(err);
      throw new Error(`${s.name}: ${s.lastError}`);
    }
  }

  /** Manda un cue a los sistemas de esa pista (o a uno concreto). Devuelve a cuántos. */
  async fire(
    orgId: string,
    track: CueTrack,
    cue: { label: string; target: string },
    deviceId?: string,
  ): Promise<number> {
    const list = (await this.org(orgId)).filter((s) =>
      deviceId ? s.id === deviceId : s.config.tracks.includes(track),
    );
    if (!list.length) return 0;
    const vars = { cue: cue.target || cue.label, label: cue.label, target: cue.target, track };
    const results = await Promise.allSettled(list.map((s) => this.sendOne(s, vars)));
    const failed = results.flatMap((r) =>
      r.status === 'rejected' ? [(r.reason as Error).message] : [],
    );
    if (failed.length) throw new Error(failed.join(' · '));
    return list.length;
  }

  /** Prueba sin mandar ningún comando: TCP abre y cierra la conexión; el resto valida. */
  static async test(config: GenericConfig): Promise<{ version: string }> {
    if (config.protocol === 'http') {
      if (!/^https?:\/\//i.test(config.url)) throw new Error('Dirección HTTP no válida');
      return { version: 'Configuración válida (prueba un cue para enviarlo)' };
    }
    if (!config.host || !config.port) throw new Error('Falta la dirección o el puerto');
    if (config.protocol === 'tcp') {
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect({ host: config.host, port: config.port });
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error('Sin respuesta (tiempo agotado)'));
        }, TIMEOUT_MS);
        sock.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        sock.once('connect', () => {
          clearTimeout(timer);
          sock.end();
          resolve();
        });
      });
      return { version: 'TCP: conexión correcta' };
    }
    return { version: 'UDP listo (sin confirmación)' };
  }

  close(): void {
    this.orgs.clear();
  }
}
