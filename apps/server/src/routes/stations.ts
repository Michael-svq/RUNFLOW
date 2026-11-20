import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LiveState } from '@runflow/core';
import {
  devices,
  fridgeItems,
  memberships,
  organizations,
  outputs,
  people,
  programs,
  roles,
  rundowns,
  rundownTemplates,
  stations,
  users,
  views,
  withSystem,
  withTenant,
} from '@runflow/db';
import { HttpError, notFound, parse } from '../errors';
import { requireAuth, requirePermission } from '../auth/guards';
import { hashToken } from '../auth/sessions';
import { requireRundown } from '../services/rundowns';
import { audit } from '../services/audit';
import { CLOSE_UNAUTHORIZED } from '../collab/collab-server';
import type { AppDeps } from '../app';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const idParams = z.object({ id: z.uuid() });
const stationInput = z.object({ name: z.string().trim().min(1, 'Obligatorio').max(60) });

const programPush = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  type: z.string().max(30),
  defaultStartTime: z.string().nullable(),
  defaultDurationMin: z.number().int().nullable(),
});
const rundownPush = z.object({
  id: z.uuid(),
  programId: z.uuid(),
  title: z.string().min(1).max(160),
  airDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  status: z.string().max(20),
});
const pushInput = z.object({
  programs: z.array(programPush).max(500).default([]),
  rundowns: z.array(rundownPush).max(2000).default([]),
});

export interface StationAuth {
  stationId: string;
  orgId: string;
}

/** Autentica una Station por su token (cabecera Authorization: Bearer). */
async function stationAuth(deps: AppDeps, req: FastifyRequest): Promise<StationAuth | null> {
  const header = req.headers.authorization ?? '';
  const token = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(header)?.[1];
  if (!token) return null;
  const [row] = await withSystem(deps.db, async (tx) => {
    const found = await tx
      .select({ id: stations.id, orgId: stations.orgId })
      .from(stations)
      .where(and(eq(stations.tokenHash, hashToken(token)), isNull(stations.revokedAt)))
      .limit(1);
    if (found[0]) {
      await tx
        .update(stations)
        .set({
          lastSeenAt: new Date(),
          lastVersion: String(req.headers['x-runflow-version'] ?? '') || null,
        })
        .where(eq(stations.id, found[0].id));
    }
    return found;
  });
  return row ? { stationId: row.id, orgId: row.orgId } : null;
}

async function requireStation(deps: AppDeps, req: FastifyRequest): Promise<StationAuth> {
  const auth = await stationAuth(deps, req);
  if (!auth) throw new HttpError(401, 'station_unauthorized', 'Station no autorizada');
  return auth;
}

const b64 = (bytes: Uint8Array | null) => (bytes ? Buffer.from(bytes).toString('base64') : null);

/**
 * Nube ↔ Station (modo híbrido, PLAN §4 y §16). La nube es la referencia de
 * usuarios, roles y programas; los documentos de las escaletas se sincronizan
 * en ambos sentidos (CRDT) y lo creado en la Station sin conexión se sube.
 */
export async function stationRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const manage = requirePermission(deps.db, 'station.admin');

  /* ---------- Gestión en la nube ---------- */

  app.get('/api/stations', { preHandler: manage }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select({
          id: stations.id,
          name: stations.name,
          lastSeenAt: stations.lastSeenAt,
          lastVersion: stations.lastVersion,
          createdAt: stations.createdAt,
        })
        .from(stations)
        .where(and(eq(stations.orgId, t.orgId), isNull(stations.revokedAt)))
        .orderBy(asc(stations.createdAt)),
    );
    return {
      stations: rows.map((r) => ({
        ...r,
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/stations', { preHandler: manage }, async (req, reply) => {
    const { name } = parse(stationInput, req.body);
    const t = req.tenant!;
    const token = randomBytes(32).toString('base64url');
    const [row] = await withTenant(deps.db, t, async (tx) => {
      const created = await tx
        .insert(stations)
        .values({ orgId: t.orgId, name, tokenHash: hashToken(token), createdBy: t.userId })
        .returning({ id: stations.id, name: stations.name });
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'station.create',
        targetType: 'station',
        targetId: created[0]!.id,
      });
      return created;
    });
    reply.status(201);
    return { station: row, token };
  });

  app.delete('/api/stations/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(stations)
        .set({ revokedAt: new Date() })
        .where(and(eq(stations.id, id), eq(stations.orgId, t.orgId), isNull(stations.revokedAt)))
        .returning({ id: stations.id }),
    );
    if (!rows.length) throw notFound('Station no encontrada');
    return { ok: true };
  });

  /** Estado de esta instalación (nube o Station) y de su enlace con la nube. */
  app.get('/api/station/status', { preHandler: requireAuth() }, async () => ({
    mode: deps.config.mode,
    version: deps.version,
    linked: !!deps.stationSync,
    sync: deps.stationSync ? { ...deps.stationSync.status } : null,
    license: deps.license?.status() ?? null,
  }));

  /** Añade o renueva la licencia de esta Station. */
  app.post('/api/station/license', { preHandler: manage }, async (req) => {
    if (!deps.license) throw notFound('Solo en una RunFlow Station');
    const { license } = parse(z.object({ license: z.string().trim().min(10).max(4000) }), req.body);
    const installed = await deps.license.install(license);
    if (!installed)
      throw new HttpError(400, 'license_invalid', 'La licencia no es válida para esta Station', {
        license: 'Licencia no válida',
      });
    const t = req.tenant!;
    await withTenant(deps.db, t, (tx) =>
      audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'station.license',
        targetType: 'license',
      }),
    );
    return { license: deps.license.status() };
  });

  /* ---------- Sincronización (autenticada con el token de la Station) ---------- */

  app.get('/api/station-sync/snapshot', async (req) => {
    const s = await requireStation(deps, req);
    const ctx = { orgId: s.orgId, userId: SYSTEM_USER };
    return withTenant(deps.db, ctx, async (tx) => {
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, s.orgId));
      const memberRows = await tx.select().from(memberships).where(eq(memberships.orgId, s.orgId));
      const userIds = memberRows.map((m) => m.userId);
      const userRows = userIds.length
        ? await withSystem(deps.db, (sys) =>
            sys
              .select()
              .from(users)
              .where(
                sql`${users.id} in (${sql.join(
                  userIds.map((id) => sql`${id}`),
                  sql`, `,
                )})`,
              ),
          )
        : [];
      return {
        organization: org,
        roles: await tx.select().from(roles).where(eq(roles.orgId, s.orgId)),
        // Las cuentas (con su hash de contraseña) permiten entrar en la Station sin internet.
        users: userRows.map((u) => ({ ...u, isPlatformAdmin: false })),
        memberships: memberRows,
        programs: await tx.select().from(programs).where(eq(programs.orgId, s.orgId)),
        rundowns: await tx
          .select({
            id: rundowns.id,
            programId: rundowns.programId,
            title: rundowns.title,
            airDate: rundowns.airDate,
            startTime: rundowns.startTime,
            endTime: rundowns.endTime,
            status: rundowns.status,
            createdBy: rundowns.createdBy,
            createdAt: rundowns.createdAt,
            deletedAt: rundowns.deletedAt,
          })
          .from(rundowns)
          .where(eq(rundowns.orgId, s.orgId)),
        views: await tx
          .select()
          .from(views)
          .where(and(eq(views.orgId, s.orgId), isNull(views.ownerUserId))),
        people: await tx.select().from(people).where(eq(people.orgId, s.orgId)),
        templates: (
          await tx.select().from(rundownTemplates).where(eq(rundownTemplates.orgId, s.orgId))
        ).map((t) => ({
          ...t,
          ydoc: b64(t.ydoc),
        })),
        fridge: await tx.select().from(fridgeItems).where(eq(fridgeItems.orgId, s.orgId)),
        outputs: await tx.select().from(outputs).where(eq(outputs.orgId, s.orgId)),
        devices: await tx.select().from(devices).where(eq(devices.orgId, s.orgId)),
      };
    });
  });

  /** Lo creado en la Station sin conexión (programas y escaletas) se da de alta en la nube. */
  app.post('/api/station-sync/push', async (req) => {
    const s = await requireStation(deps, req);
    const input = parse(pushInput, req.body);
    const ctx = { orgId: s.orgId, userId: SYSTEM_USER };
    await withTenant(deps.db, ctx, async (tx) => {
      if (input.programs.length) {
        await tx
          .insert(programs)
          .values(input.programs.map((p) => ({ ...p, orgId: s.orgId })))
          .onConflictDoNothing();
      }
      if (input.rundowns.length) {
        await tx
          .insert(rundowns)
          .values(input.rundowns.map((r) => ({ ...r, orgId: s.orgId })))
          .onConflictDoNothing();
      }
    });
    return { ok: true };
  });

  /** Estado del directo que lleva la Station (la nube lo refleja). */
  app.post('/api/station-sync/live/:rundownId', async (req) => {
    const s = await requireStation(deps, req);
    const rundownId = z.uuid().parse((req.params as { rundownId: string }).rundownId);
    const { live } = parse(z.object({ live: z.record(z.string(), z.unknown()) }), req.body);
    await withTenant(deps.db, { orgId: s.orgId, userId: SYSTEM_USER }, (tx) =>
      requireRundown(tx, s.orgId, rundownId),
    );
    await deps.live!.mirror(s.orgId, rundownId, live as unknown as LiveState);
    return { ok: true };
  });

  /** Documento de una escaleta, en ambos sentidos, para la Station. */
  app.get('/api/station-sync/collab/:rundownId', { websocket: true }, async (socket, req) => {
    const collab = deps.collab!;
    const pending = collab.buffer(socket);
    try {
      const s = await stationAuth(deps, req);
      if (!s) return socket.close(CLOSE_UNAUTHORIZED, 'Station no autorizada');
      const rundownId = z.uuid().parse((req.params as { rundownId: string }).rundownId);
      await withTenant(deps.db, { orgId: s.orgId, userId: SYSTEM_USER }, (tx) =>
        requireRundown(tx, s.orgId, rundownId),
      );
      await collab.handleConnection(
        socket,
        rundownId,
        { orgId: s.orgId, userId: SYSTEM_USER, readOnly: false, canControl: false },
        pending,
      );
    } catch (err) {
      req.log.warn({ err }, 'Conexión de Station rechazada');
      socket.close(4404, 'Escaleta no encontrada');
    }
  });
}
