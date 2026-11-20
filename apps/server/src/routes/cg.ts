import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEVICE_KINDS,
  deviceInput,
  parseDeviceConfig,
  type CasparConfig,
  orgSettingsPatch,
  readOrgSettings,
  type DeviceDto,
  type OrgSettings,
} from '@runflow/core';
import { devices, organizations, withTenant } from '@runflow/db';
import { HttpError, notFound, parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import { requireRundown } from '../services/rundowns';
import { CgManager } from '../cg/cg-manager';
import { MixerManager } from '../mixers/mixer-manager';
import { templateHtml } from '../cg/templates';
import type { AppDeps } from '../app';

const idParams = z.object({ id: z.uuid() });
const graphicInput = z.object({ graphicId: z.string().min(1).max(64) });
const clipInput = z.object({ action: z.enum(['pause', 'resume', 'stop', 'loop']) });
const require = createRequire(import.meta.url);

const FONTS: Record<string, string> = {
  'montserrat-700.woff2': '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2',
  'montserrat-900.woff2': '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2',
};

/**
 * RunFlow CG: Configuración Master, equipos (CasparCG), plantillas HTML y
 * órdenes manuales (▶/■ de rótulos, control del VTR).
 */
export async function cgRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const cg = () => deps.cg!;
  const org = requireOrg(deps.db);
  const configure = requirePermission(deps.db, 'org.configure');
  const view = requirePermission(deps.db, 'rundown.view');
  const fire = requirePermission(deps.db, 'cg.fire');
  const go = requirePermission(deps.db, 'live.go');

  /* ---------- Plantillas (públicas: las carga CasparCG) ---------- */

  app.get('/cg/templates/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    const type = /^([A-Z]{3})\.html$/.exec(file)?.[1];
    const html = type ? templateHtml(type) : null;
    if (!html) throw notFound('Plantilla no encontrada');
    return reply
      .header('cache-control', 'no-cache')
      .header('access-control-allow-origin', '*')
      .type('text/html; charset=utf-8')
      .send(html);
  });

  app.get('/cg/fonts/:file', async (req, reply) => {
    const spec = FONTS[(req.params as { file: string }).file];
    if (!spec) throw notFound('Fuente no encontrada');
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('access-control-allow-origin', '*')
      .type('font/woff2')
      .send(createReadStream(require.resolve(spec)));
  });

  /* ---------- Configuración Master ---------- */

  app.get('/api/org/settings', { preHandler: org }, async (req) => ({
    settings: await cg().settings(req.tenant!.orgId),
  }));

  app.patch('/api/org/settings', { preHandler: configure }, async (req) => {
    const patch = parse(orgSettingsPatch, req.body);
    const t = req.tenant!;
    const settings = await withTenant(deps.db, t, async (tx) => {
      const [row] = await tx
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, t.orgId));
      const current = readOrgSettings(row?.settings);
      const next: OrgSettings = readOrgSettings({
        ...current,
        ...patch,
        cgDesign: { ...current.cgDesign, ...(patch.cgDesign ?? {}) },
      });
      await tx
        .update(organizations)
        .set({ settings: next, updatedAt: new Date() })
        .where(eq(organizations.id, t.orgId));
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'org.settings',
        targetType: 'organization',
        targetId: t.orgId,
      });
      return next;
    });
    await cg().invalidate(t.orgId);
    return { settings };
  });

  /* ---------- Equipos ---------- */

  const toDto = async (
    orgId: string,
    rows: (typeof devices.$inferSelect)[],
  ): Promise<DeviceDto[]> => {
    const statuses = {
      ...(await cg().deviceStatuses(orgId)),
      ...(await deps.mixers!.deviceStatuses(orgId)),
    };
    return rows.flatMap((r) => {
      const config = parseDeviceConfig(r.kind, r.config);
      if (!config) return [];
      return [
        {
          id: r.id,
          name: r.name,
          kind: r.kind,
          enabled: r.enabled,
          config,
          status: statuses[r.id] ?? {
            connected: false,
            error: r.enabled ? null : 'Desactivado',
            version: null,
          },
        } as DeviceDto,
      ];
    });
  };
  const invalidate = async (orgId: string) => {
    await cg().invalidate(orgId);
    await deps.mixers!.invalidate(orgId);
  };

  app.get('/api/devices', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx.select().from(devices).where(eq(devices.orgId, t.orgId)).orderBy(asc(devices.createdAt)),
    );
    return { devices: await toDto(t.orgId, rows) };
  });

  app.post('/api/devices', { preHandler: configure }, async (req, reply) => {
    const input = parse(deviceInput, req.body);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, async (tx) => {
      const created = await tx
        .insert(devices)
        .values({ orgId: t.orgId, ...input })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'device.create',
        targetType: 'device',
        targetId: created[0]!.id,
      });
      return created;
    });
    await invalidate(t.orgId);
    reply.status(201);
    return { device: (await toDto(t.orgId, rows))[0] };
  });

  app.patch('/api/devices/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(deviceInput, req.body);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(devices)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(devices.id, id), eq(devices.orgId, t.orgId)))
        .returning(),
    );
    if (!rows.length) throw notFound('Equipo no encontrado');
    await invalidate(t.orgId);
    return { device: (await toDto(t.orgId, rows))[0] };
  });

  app.delete('/api/devices/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(devices)
        .where(and(eq(devices.id, id), eq(devices.orgId, t.orgId)))
        .returning({ id: devices.id }),
    );
    if (!rows.length) throw notFound('Equipo no encontrado');
    await invalidate(t.orgId);
    return { ok: true };
  });

  /** Prueba de conexión con un equipo (antes de guardarlo). */
  app.post('/api/devices/test', { preHandler: configure }, async (req) => {
    const input = parse(
      z.object({ kind: z.enum(DEVICE_KINDS).default('casparcg'), config: z.unknown() }),
      req.body,
    );
    const config = parseDeviceConfig(input.kind, input.config);
    if (!config) throw new HttpError(400, 'invalid_config', 'Configuración no válida');
    try {
      return input.kind === 'casparcg'
        ? { ok: true, ...(await CgManager.test(config as CasparConfig)) }
        : { ok: true, ...(await MixerManager.test(input.kind, config)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** Entradas o escenas de un mezclador conectado (para el mapa de fuentes). */
  app.get('/api/devices/:id/inputs', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    try {
      return { inputs: await deps.mixers!.inputs(req.tenant!.orgId, id) };
    } catch (err) {
      throw new HttpError(
        409,
        'device_offline',
        err instanceof Error ? err.message : 'Sin conexión',
      );
    }
  });

  app.get('/api/cg/clips', { preHandler: view }, async (req) => cg().clips(req.tenant!.orgId));

  /* ---------- Directo: rótulos y VTR ---------- */

  const rundownOf = async (req: FastifyRequest) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    await withTenant(deps.db, t, (tx) => requireRundown(tx, t.orgId, id));
    return { id, actor: { orgId: t.orgId, userId: t.userId } };
  };

  app.get('/api/rundowns/:id/mixers', { preHandler: view }, async (req) => {
    const { id, actor } = await rundownOf(req);
    return { mixers: await deps.mixers!.snapshot(id, actor.orgId) };
  });

  app.get('/api/rundowns/:id/cg', { preHandler: view }, async (req) => {
    const { id, actor } = await rundownOf(req);
    return { cg: await cg().snapshot(id, actor.orgId) };
  });

  app.post('/api/rundowns/:id/cg/take', { preHandler: fire }, async (req) => {
    const { id, actor } = await rundownOf(req);
    const { graphicId } = parse(graphicInput, req.body);
    try {
      return { cg: await cg().take(actor, id, graphicId) };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404)
        throw notFound('Rótulo no encontrado');
      throw err;
    }
  });

  app.post('/api/rundowns/:id/cg/out', { preHandler: fire }, async (req) => {
    const { id, actor } = await rundownOf(req);
    const { graphicId } = parse(graphicInput, req.body);
    return { cg: await cg().out(actor, id, graphicId) };
  });

  app.post('/api/rundowns/:id/cg/clear', { preHandler: fire }, async (req) => {
    const { id, actor } = await rundownOf(req);
    return { cg: await cg().clearGraphics(actor, id) };
  });

  app.post('/api/rundowns/:id/cg/clip', { preHandler: go }, async (req) => {
    const { id, actor } = await rundownOf(req);
    const { action } = parse(clipInput, req.body);
    if (!deps.cg) throw new HttpError(503, 'cg_unavailable', 'RunFlow CG no disponible');
    return { cg: await cg().clip(actor, id, action) };
  });
}
