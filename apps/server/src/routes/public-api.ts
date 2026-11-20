import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  apiCellsInput,
  apiLineInput,
  apiTokenInput,
  webhookInput,
  type ApiScope,
  type ApiTokenDto,
  type WebhookDto,
  type WebhookEvent,
} from '@runflow/core';
import { insertLine, readLines, setCells, type CellValue } from '@runflow/sync';
import { apiTokens, programs, rundowns, webhooks, withSystem, withTenant } from '@runflow/db';
import { HttpError, notFound, parse } from '../errors';
import { requirePermission } from '../auth/guards';
import { hashToken } from '../auth/sessions';
import { audit } from '../services/audit';
import { requireRundown } from '../services/rundowns';
import type { AppDeps } from '../app';

/*
 * F2.4 API pública: /api/v1 con tokens de empresa (Authorization: Bearer
 * rf_…) y alcances read / live / write; gestión de tokens y webhooks.
 */

const idParams = z.object({ id: z.uuid() });
const lineParams = z.object({ id: z.uuid(), lineId: z.string().min(1).max(64) });
const graphicInput = z.object({ graphicId: z.string().min(1).max(64) });
const listQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

interface ApiActor {
  orgId: string;
  userId: string | null;
  tokenId: string;
  scopes: ApiScope[];
}

declare module 'fastify' {
  interface FastifyRequest {
    api?: ApiActor;
  }
}

export async function publicApiRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const configure = requirePermission(deps.db, 'org.configure');

  /* ---------- Gestión (Configuración) ---------- */

  app.get('/api/api-tokens', { preHandler: configure }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.orgId, t.orgId), isNull(apiTokens.revokedAt)))
        .orderBy(asc(apiTokens.createdAt)),
    );
    const tokens: ApiTokenDto[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      scopes: r.scopes as ApiScope[],
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { tokens };
  });

  app.post('/api/api-tokens', { preHandler: configure }, async (req, reply) => {
    const input = parse(apiTokenInput, req.body);
    const t = req.tenant!;
    const token = `rf_${randomBytes(30).toString('base64url')}`;
    const [row] = await withTenant(deps.db, t, async (tx) => {
      const created = await tx
        .insert(apiTokens)
        .values({
          orgId: t.orgId,
          name: input.name,
          tokenHash: hashToken(token),
          scopes: [...new Set(input.scopes)],
          createdBy: t.userId,
        })
        .returning({ id: apiTokens.id, name: apiTokens.name });
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'api_token.create',
        targetType: 'api_token',
        targetId: created[0]!.id,
        data: { scopes: input.scopes },
      });
      return created;
    });
    reply.status(201);
    // El token solo se muestra ahora.
    return { token, id: row!.id };
  });

  app.delete('/api/api-tokens/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiTokens.id, id), eq(apiTokens.orgId, t.orgId), isNull(apiTokens.revokedAt)))
        .returning({ id: apiTokens.id }),
    );
    if (!rows.length) throw notFound('Token no encontrado');
    return { ok: true };
  });

  const webhookDto = (r: typeof webhooks.$inferSelect): WebhookDto => ({
    id: r.id,
    url: r.url,
    events: r.events as WebhookEvent[],
    enabled: r.enabled,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
  });

  app.get('/api/webhooks', { preHandler: configure }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(webhooks)
        .where(eq(webhooks.orgId, t.orgId))
        .orderBy(asc(webhooks.createdAt)),
    );
    return { webhooks: rows.map(webhookDto) };
  });

  app.post('/api/webhooks', { preHandler: configure }, async (req, reply) => {
    const input = parse(webhookInput, req.body);
    const t = req.tenant!;
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .insert(webhooks)
        .values({
          orgId: t.orgId,
          url: input.url,
          events: [...new Set(input.events)],
          enabled: input.enabled,
          secretEnc: deps.secrets!.encrypt(secret),
        })
        .returning(),
    );
    deps.webhooks!.invalidate(t.orgId);
    reply.status(201);
    // El secreto de firma solo se muestra ahora.
    return { webhook: webhookDto(row!), secret };
  });

  app.patch('/api/webhooks/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(webhookInput, req.body);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(webhooks)
        .set({ url: input.url, events: [...new Set(input.events)], enabled: input.enabled })
        .where(and(eq(webhooks.id, id), eq(webhooks.orgId, t.orgId)))
        .returning(),
    );
    if (!rows[0]) throw notFound('Webhook no encontrado');
    deps.webhooks!.invalidate(t.orgId);
    return { webhook: webhookDto(rows[0]) };
  });

  app.delete('/api/webhooks/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(webhooks)
        .where(and(eq(webhooks.id, id), eq(webhooks.orgId, t.orgId)))
        .returning({ id: webhooks.id }),
    );
    if (!rows.length) throw notFound('Webhook no encontrado');
    deps.webhooks!.invalidate(t.orgId);
    return { ok: true };
  });

  app.post('/api/webhooks/:id/test', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.id, id), eq(webhooks.orgId, t.orgId))),
    );
    if (!row) throw notFound('Webhook no encontrado');
    return deps.webhooks!.deliver(row, 'ping', { message: 'Prueba de RunFlow' });
  });

  /* ---------- API v1 (token de empresa) ---------- */

  const auth =
    (scope: ApiScope) =>
    async (req: FastifyRequest): Promise<void> => {
      const token = /^Bearer (rf_[A-Za-z0-9_-]{20,80})$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) throw new HttpError(401, 'unauthorized', 'Falta el token de la API');
      const [row] = await withSystem(deps.db, async (tx) => {
        const found = await tx
          .select()
          .from(apiTokens)
          .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
          .limit(1);
        if (found[0])
          await tx
            .update(apiTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiTokens.id, found[0].id));
        return found;
      });
      if (!row) throw new HttpError(401, 'unauthorized', 'Token no válido o revocado');
      const scopes = row.scopes as ApiScope[];
      if (!scopes.includes(scope))
        throw new HttpError(403, 'forbidden', `Este token no tiene el permiso «${scope}»`);
      req.api = { orgId: row.orgId, userId: row.createdBy, tokenId: row.id, scopes };
    };
  const limit = { rateLimit: { max: 600, timeWindow: '1 minute' } };
  const ctx = (req: FastifyRequest) => ({
    orgId: req.api!.orgId,
    userId: req.api!.userId ?? '00000000-0000-0000-0000-000000000000',
  });
  const rundownFor = async (req: FastifyRequest) => {
    const { id } = parse(idParams, req.params);
    await withTenant(deps.db, ctx(req), (tx) => requireRundown(tx, req.api!.orgId, id));
    return id;
  };
  const actor = (req: FastifyRequest) => {
    if (!req.api!.userId) throw new HttpError(403, 'forbidden', 'El token no tiene propietario');
    return { orgId: req.api!.orgId, userId: req.api!.userId };
  };

  app.get('/api/v1/rundowns', { preHandler: auth('read'), config: limit }, async (req) => {
    const q = parse(listQuery, req.query);
    const rows = await withTenant(deps.db, ctx(req), (tx) =>
      tx
        .select({
          id: rundowns.id,
          title: rundowns.title,
          program: programs.name,
          airDate: rundowns.airDate,
          startTime: rundowns.startTime,
          endTime: rundowns.endTime,
          status: rundowns.status,
        })
        .from(rundowns)
        .innerJoin(programs, eq(programs.id, rundowns.programId))
        .where(
          and(
            eq(rundowns.orgId, req.api!.orgId),
            isNull(rundowns.deletedAt),
            q.from ? gte(rundowns.airDate, q.from) : undefined,
            q.to ? lte(rundowns.airDate, q.to) : undefined,
          ),
        )
        .orderBy(desc(rundowns.airDate), asc(rundowns.startTime))
        .limit(200),
    );
    return { rundowns: rows };
  });

  app.get('/api/v1/rundowns/:id', { preHandler: auth('read'), config: limit }, async (req) => {
    const id = await rundownFor(req);
    const [row] = await withTenant(deps.db, ctx(req), (tx) =>
      tx
        .select({
          id: rundowns.id,
          title: rundowns.title,
          airDate: rundowns.airDate,
          startTime: rundowns.startTime,
          endTime: rundowns.endTime,
          status: rundowns.status,
        })
        .from(rundowns)
        .where(eq(rundowns.id, id)),
    );
    const lines = await deps.collab!.withDoc(id, req.api!.orgId, (doc) =>
      readLines(doc).map((l) => ({ id: l.id, cells: l.cells })),
    );
    const live = await deps.live!.get(ctx(req), id);
    return { rundown: row, lines, live };
  });

  app.get('/api/v1/rundowns/:id/live', { preHandler: auth('read'), config: limit }, async (req) => {
    const id = await rundownFor(req);
    return { live: await deps.live!.get(ctx(req), id) };
  });

  for (const action of ['go', 'back', 'stop'] as const) {
    app.post(
      `/api/v1/rundowns/:id/live/${action}`,
      { preHandler: auth('live'), config: limit },
      async (req) => {
        const id = await rundownFor(req);
        const a = actor(req);
        const live =
          action === 'go'
            ? await deps.live!.go(a, id, { trigger: 'go' })
            : action === 'back'
              ? await deps.live!.back(a, id)
              : await deps.live!.stop(a, id);
        return { live };
      },
    );
  }

  app.post(
    '/api/v1/rundowns/:id/cg/take',
    { preHandler: auth('live'), config: limit },
    async (req) => {
      const id = await rundownFor(req);
      const { graphicId } = parse(graphicInput, req.body);
      return { cg: await deps.cg!.take(actor(req), id, graphicId) };
    },
  );

  app.post(
    '/api/v1/rundowns/:id/cg/out',
    { preHandler: auth('live'), config: limit },
    async (req) => {
      const id = await rundownFor(req);
      const { graphicId } = parse(graphicInput, req.body);
      return { cg: await deps.cg!.out(actor(req), id, graphicId) };
    },
  );

  app.post(
    '/api/v1/rundowns/:id/lines',
    { preHandler: auth('write'), config: limit },
    async (req, reply) => {
      const id = await rundownFor(req);
      const input = parse(apiLineInput, req.body);
      const lineId = await deps.collab!.withDoc(id, req.api!.orgId, (doc) =>
        insertLine(doc, {
          ...(input.index !== undefined ? { index: input.index } : {}),
          cells: input.cells as Record<string, CellValue>,
        }),
      );
      reply.status(201);
      return { lineId };
    },
  );

  app.patch(
    '/api/v1/rundowns/:id/lines/:lineId',
    { preHandler: auth('write'), config: limit },
    async (req) => {
      await rundownFor(req);
      const { id, lineId } = parse(lineParams, req.params);
      const { cells } = parse(apiCellsInput, req.body);
      const found = await deps.collab!.withDoc(id, req.api!.orgId, (doc) => {
        if (!readLines(doc).some((l) => l.id === lineId)) return false;
        setCells(
          doc,
          Object.entries(cells).map(([key, value]) => ({
            id: lineId,
            key,
            value: value as CellValue,
          })),
        );
        return true;
      });
      if (!found) throw notFound('Línea no encontrada');
      return { ok: true };
    },
  );
}
