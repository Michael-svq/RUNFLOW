import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CONTROL_ACTIONS,
  createOutputInput,
  outputSettings,
  updateOutputInput,
  type OutputDto,
  type OutputKind,
  type PublicOutputDto,
} from '@runflow/core';
import { organizations, outputs, rundowns, withSystem, withTenant } from '@runflow/db';
import { forbidden, notFound, parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { hashToken } from '../auth/sessions';
import { requireRundown } from '../services/rundowns';
import { CLOSE_NOT_FOUND } from '../collab/collab-server';
import { audit } from '../services/audit';
import type { AppDeps } from '../app';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const idParams = z.object({ id: z.uuid() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

function toDto(o: typeof outputs.$inferSelect): OutputDto {
  return {
    id: o.id,
    rundownId: o.rundownId,
    kind: o.kind as OutputKind,
    name: o.name,
    settings: outputSettings(o.settings),
    createdAt: o.createdAt.toISOString(),
  };
}

/** Busca una salida activa por su token (sin sesión: transacción de sistema). */
async function findByToken(deps: AppDeps, token: string) {
  const [row] = await withSystem(deps.db, (tx) =>
    tx
      .select({
        output: outputs,
        orgName: organizations.name,
        timezone: organizations.timezone,
        rundown: {
          id: rundowns.id,
          title: rundowns.title,
          airDate: rundowns.airDate,
          startTime: rundowns.startTime,
          endTime: rundowns.endTime,
        },
      })
      .from(outputs)
      .innerJoin(rundowns, eq(rundowns.id, outputs.rundownId))
      .innerJoin(organizations, eq(organizations.id, outputs.orgId))
      .where(
        and(
          eq(outputs.tokenHash, hashToken(token)),
          isNull(outputs.revokedAt),
          isNull(rundowns.deletedAt),
        ),
      )
      .limit(1),
  );
  return row;
}

/** Salidas por enlace: prompter, presentador, relojes, agenda, mensajes, multivista. */
export async function outputRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'rundown.view');
  const org = requireOrg(deps.db);
  // Gestionan salidas quienes controlan el prompter o el directo.
  const manage = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (!p.includes('prompter.control') && !p.includes('live.go')) throw forbidden();
  };

  app.get('/api/rundowns/:id/outputs', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, async (tx) => {
      await requireRundown(tx, t.orgId, id);
      return tx
        .select()
        .from(outputs)
        .where(and(eq(outputs.rundownId, id), isNull(outputs.revokedAt)))
        .orderBy(asc(outputs.createdAt));
    });
    return { outputs: rows.map(toDto) };
  });

  /** Mensaje al plató (presentador y salidas de la escaleta). Vacío = quitarlo. */
  app.post('/api/rundowns/:id/stage', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(
      z.object({
        text: z.string().trim().max(200).default(''),
        color: z.enum(['white', 'yellow', 'red', 'green']).default('yellow'),
        flash: z.boolean().default(false),
      }),
      req.body,
    );
    const t = req.tenant!;
    await withTenant(deps.db, t, (tx) => requireRundown(tx, t.orgId, id));
    const message = input.text ? { ...input, sentAt: Date.now(), from: req.auth!.name } : null;
    await deps.collab!.setStage(id, t.orgId, message);
    return { message };
  });

  app.post('/api/rundowns/:id/outputs', { preHandler: manage }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(createOutputInput, req.body);
    const t = req.tenant!;
    // Un mando da GO sin iniciar sesión: solo lo crea quien puede dar GO.
    if (input.kind === 'control' && !t.permissions.includes('live.go')) throw forbidden();
    const token = randomBytes(24).toString('base64url');
    const row = await withTenant(deps.db, t, async (tx) => {
      await requireRundown(tx, t.orgId, id);
      const [created] = await tx
        .insert(outputs)
        .values({
          orgId: t.orgId,
          rundownId: id,
          kind: input.kind,
          name: input.name,
          tokenHash: hashToken(token),
          settings: outputSettings(input.settings),
          createdBy: t.userId,
        })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'output.create',
        targetType: 'output',
        targetId: created!.id,
        data: { kind: input.kind, rundownId: id },
      });
      return created!;
    });
    reply.status(201);
    // El token solo se devuelve ahora (en la base de datos se guarda su hash).
    return { output: toDto(row), token };
  });

  app.patch('/api/outputs/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(updateOutputInput, req.body);
    const t = req.tenant!;
    const row = await withTenant(deps.db, t, async (tx) => {
      const [current] = await tx
        .select()
        .from(outputs)
        .where(and(eq(outputs.id, id), eq(outputs.orgId, t.orgId), isNull(outputs.revokedAt)))
        .limit(1);
      if (!current) throw notFound('Salida no encontrada');
      const [updated] = await tx
        .update(outputs)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.settings
            ? {
                settings: outputSettings({
                  ...outputSettings(current.settings),
                  ...input.settings,
                }),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(outputs.id, id))
        .returning();
      return updated!;
    });
    deps.collab?.broadcastOutputSettings(row.rundownId, row.id, outputSettings(row.settings));
    return { output: toDto(row) };
  });

  app.delete('/api/outputs/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(outputs)
        .set({ revokedAt: new Date() })
        .where(and(eq(outputs.id, id), eq(outputs.orgId, t.orgId), isNull(outputs.revokedAt)))
        .returning({ id: outputs.id, rundownId: outputs.rundownId }),
    );
    if (!rows.length) throw notFound('Salida no encontrada');
    deps.collab?.closeOutput(rows[0]!.rundownId, rows[0]!.id);
    return { ok: true };
  });

  /* ---------- Público (sin sesión) ---------- */

  app.get(
    '/api/public/outputs/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const parsed = tokenParams.safeParse(req.params);
      if (!parsed.success) throw notFound('Enlace no válido o revocado');
      const row = await findByToken(deps, parsed.data.token);
      if (!row) throw notFound('Enlace no válido o revocado');
      const dto: PublicOutputDto = {
        kind: row.output.kind as OutputKind,
        name: row.output.name,
        settings: outputSettings(row.output.settings),
        orgName: row.orgName,
        rundown: { ...row.rundown, timezone: row.timezone },
      };
      return { output: dto };
    },
  );

  app.get('/api/public/outputs/:token/live', async (req) => {
    const parsed = tokenParams.safeParse(req.params);
    if (!parsed.success) throw notFound('Enlace no válido o revocado');
    const row = await findByToken(deps, parsed.data.token);
    if (!row) throw notFound('Enlace no válido o revocado');
    return {
      live: await deps.live!.get({ orgId: row.output.orgId, userId: SYSTEM_USER }, row.rundown.id),
    };
  });

  /* ---------- Mando por enlace (Companion, Stream Deck, tablet) ---------- */

  const controlParams = z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    action: z.enum(CONTROL_ACTIONS),
  });

  /** Estado para los botones (feedback de Companion). */
  app.get(
    '/api/public/control/:token',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req) => {
      const parsed = tokenParams.safeParse(req.params);
      const row = parsed.success ? await findByToken(deps, parsed.data.token) : undefined;
      if (!row || row.output.kind !== 'control') throw notFound('Enlace no válido o revocado');
      const actor = { orgId: row.output.orgId, userId: SYSTEM_USER };
      const live = await deps.live!.get(actor, row.rundown.id);
      const cg = await deps.cg!.snapshot(row.rundown.id, row.output.orgId);
      return {
        rundown: row.rundown.title,
        onAir: live.onAir,
        next: live.next,
        armed: live.armed,
        rehearsal: live.rehearsal,
        graphicsOnAir: Object.keys(cg.graphics).length,
      };
    },
  );

  app.post(
    '/api/public/control/:token/:action',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req) => {
      const parsed = controlParams.safeParse(req.params);
      const row = parsed.success ? await findByToken(deps, parsed.data.token) : undefined;
      if (!row || row.output.kind !== 'control') throw notFound('Enlace no válido o revocado');
      if (!row.output.createdBy) throw notFound('Enlace no válido o revocado');
      // Las órdenes quedan registradas a nombre de quien creó el mando.
      const actor = { orgId: row.output.orgId, userId: row.output.createdBy };
      const id = row.rundown.id;
      switch (parsed.data!.action) {
        case 'go':
          return { live: await deps.live!.go(actor, id, { trigger: 'go' }) };
        case 'back':
          return { live: await deps.live!.back(actor, id) };
        case 'stop':
          return { live: await deps.live!.stop(actor, id) };
        case 'next-graphic':
          return { cg: await deps.cg!.takeNext(actor, id) };
        case 'clear-graphics':
          return { cg: await deps.cg!.clearGraphics(actor, id) };
      }
    },
  );

  // Conexión de solo lectura de una salida (documento + directo + prompter + mensajes).
  // No usa cookie: el token del enlace es la credencial.
  app.get('/api/collab-output/:token', { websocket: true }, async (socket, req) => {
    const collab = deps.collab!;
    const pending = collab.buffer(socket);
    const parsed = tokenParams.safeParse(req.params);
    if (!parsed.success) return socket.close(CLOSE_NOT_FOUND, 'Enlace no válido');
    try {
      const row = await findByToken(deps, parsed.data.token);
      if (!row) return socket.close(CLOSE_NOT_FOUND, 'Enlace no válido o revocado');
      await collab.handleConnection(
        socket,
        row.rundown.id,
        {
          orgId: row.output.orgId,
          userId: SYSTEM_USER,
          readOnly: true,
          canControl: false,
          outputId: row.output.id,
        },
        pending,
      );
    } catch (err) {
      req.log.error({ err }, 'Error al conectar una salida');
      socket.close(1011, 'Error interno');
    }
  });
}
