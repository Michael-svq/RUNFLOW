import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AiError, buildPrompt, complete, parseOutput, type AiProviderConfig } from '@runflow/ai';
import {
  aiProviderInput,
  aiRunInput,
  readOrgSettings,
  type AiKind,
  type AiProviderDto,
  type AiRunResult,
  type AiUsageDto,
} from '@runflow/core';
import { aiProviders, aiUsage, organizations, withTenant, type Tx } from '@runflow/db';
import { forbidden, HttpError, notFound, parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import type { AppDeps } from '../app';

const idParams = z.object({ id: z.uuid() });

type ProviderRow = typeof aiProviders.$inferSelect;

const toDto = (r: ProviderRow): AiProviderDto => ({
  id: r.id,
  kind: r.kind as AiKind,
  name: r.name,
  model: r.model,
  baseUrl: r.baseUrl,
  hasKey: !!r.apiKeyEnc,
  isDefault: r.isDefault,
  enabled: r.enabled,
});

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/**
 * IA multiproveedor (PLAN §18): cada empresa configura sus proveedores y
 * claves (cifradas); las llamadas salen del servidor, con límite mensual y
 * registro de consumo.
 */
export async function aiRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const configure = requirePermission(deps.db, 'org.configure');
  const org = requireOrg(deps.db);
  // Usan la IA quienes escriben guiones.
  const writer = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (!p.includes('script.edit_own') && !p.includes('script.edit_any')) throw forbidden();
  };
  const box = () => deps.secrets!;

  const config = (row: ProviderRow): AiProviderConfig => ({
    kind: row.kind as AiKind,
    model: row.model,
    baseUrl: row.baseUrl,
    apiKey: row.apiKeyEnc ? box().decrypt(row.apiKeyEnc) : null,
  });

  /* ---------- Proveedores ---------- */

  app.get('/api/ai/providers', { preHandler: org }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.orgId, t.orgId))
        .orderBy(asc(aiProviders.createdAt)),
    );
    // Quien no configura solo ve los activos (para elegir en el editor).
    const all = t.permissions.includes('org.configure');
    return { providers: rows.filter((r) => all || r.enabled).map(toDto) };
  });

  const save = async (req: FastifyRequest, id: string | null) => {
    const input = parse(aiProviderInput, req.body);
    const t = req.tenant!;
    const keyPatch =
      input.apiKey === undefined
        ? {}
        : { apiKeyEnc: input.apiKey.trim() ? box().encrypt(input.apiKey.trim()) : null };
    return withTenant(deps.db, t, async (tx) => {
      if (input.isDefault) {
        await tx
          .update(aiProviders)
          .set({ isDefault: false })
          .where(eq(aiProviders.orgId, t.orgId));
      }
      const values = {
        kind: input.kind,
        name: input.name,
        model: input.model,
        baseUrl: input.baseUrl,
        isDefault: input.isDefault,
        enabled: input.enabled,
        ...keyPatch,
      };
      const rows = id
        ? await tx
            .update(aiProviders)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(aiProviders.id, id), eq(aiProviders.orgId, t.orgId)))
            .returning()
        : await tx
            .insert(aiProviders)
            .values({ orgId: t.orgId, ...values })
            .returning();
      if (!rows[0]) throw notFound('Proveedor no encontrado');
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: id ? 'ai.provider.update' : 'ai.provider.create',
        targetType: 'ai_provider',
        targetId: rows[0].id,
        data: { kind: input.kind, model: input.model, keyChanged: input.apiKey !== undefined },
      });
      return rows[0];
    });
  };

  app.post('/api/ai/providers', { preHandler: configure }, async (req, reply) => {
    const row = await save(req, null);
    reply.status(201);
    return { provider: toDto(row) };
  });

  app.patch('/api/ai/providers/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { provider: toDto(await save(req, id)) };
  });

  app.delete('/api/ai/providers/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(aiProviders)
        .where(and(eq(aiProviders.id, id), eq(aiProviders.orgId, t.orgId)))
        .returning({ id: aiProviders.id }),
    );
    if (!rows.length) throw notFound('Proveedor no encontrado');
    return { ok: true };
  });

  /** Prueba un proveedor guardado con una petición mínima. */
  app.post('/api/ai/providers/:id/test', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(aiProviders)
        .where(and(eq(aiProviders.id, id), eq(aiProviders.orgId, t.orgId))),
    );
    if (!row) throw notFound('Proveedor no encontrado');
    try {
      const res = await complete(config(row), {
        system: 'Responde solo con la palabra OK.',
        prompt: 'Prueba de conexión.',
        maxTokens: 50,
        timeoutMs: 60_000,
      });
      return { ok: true, model: res.model, reply: res.text.slice(0, 80) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /* ---------- Consumo ---------- */

  const monthTokens = async (tx: Tx, orgId: string) => {
    const [row] = await tx
      .select({
        total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, monthStart())));
    return row?.total ?? 0;
  };

  app.get('/api/ai/usage', { preHandler: org }, async (req): Promise<AiUsageDto> => {
    const t = req.tenant!;
    return withTenant(deps.db, t, async (tx) => {
      const [orgRow] = await tx
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, t.orgId));
      const since = monthStart();
      const tokens = sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int`;
      const requests = sql<number>`count(*)::int`;
      const byFeature = await tx
        .select({ feature: aiUsage.feature, requests, tokens })
        .from(aiUsage)
        .where(and(eq(aiUsage.orgId, t.orgId), gte(aiUsage.createdAt, since)))
        .groupBy(aiUsage.feature);
      const byProvider = await tx
        .select({
          providerId: aiUsage.providerId,
          name: sql<string>`coalesce(max(${aiProviders.name}), '(eliminado)')`,
          requests,
          tokens,
        })
        .from(aiUsage)
        .leftJoin(aiProviders, eq(aiProviders.id, aiUsage.providerId))
        .where(and(eq(aiUsage.orgId, t.orgId), gte(aiUsage.createdAt, since)))
        .groupBy(aiUsage.providerId);
      return {
        month: since.toISOString().slice(0, 7),
        totalTokens: byFeature.reduce((n, f) => n + f.tokens, 0),
        limit: readOrgSettings(orgRow?.settings).aiMonthlyTokens,
        byFeature,
        byProvider,
      };
    });
  });

  /* ---------- Funciones de redacción ---------- */

  app.post(
    '/api/ai/run',
    { preHandler: writer, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req): Promise<AiRunResult> => {
      const input = parse(aiRunInput, req.body);
      const t = req.tenant!;
      const { row, limit, used } = await withTenant(deps.db, t, async (tx) => {
        const rows = await tx
          .select()
          .from(aiProviders)
          .where(and(eq(aiProviders.orgId, t.orgId), eq(aiProviders.enabled, true)));
        const row = input.providerId
          ? rows.find((r) => r.id === input.providerId)
          : (rows.find((r) => r.isDefault) ?? rows[0]);
        const [orgRow] = await tx
          .select({ settings: organizations.settings })
          .from(organizations)
          .where(eq(organizations.id, t.orgId));
        return {
          row,
          limit: readOrgSettings(orgRow?.settings).aiMonthlyTokens,
          used: await monthTokens(tx, t.orgId),
        };
      });
      if (!row) {
        throw new HttpError(
          409,
          'ai_not_configured',
          'No hay ningún proveedor de IA activo. Configúralo en 10 Configuración.',
        );
      }
      if (limit > 0 && used >= limit) {
        throw new HttpError(
          429,
          'ai_limit',
          'Se ha alcanzado el límite mensual de IA de la empresa',
        );
      }
      const prompt = buildPrompt(input.feature, input.text, input.options);
      let result;
      try {
        result = await complete(config(row), prompt);
      } catch (err) {
        await withTenant(deps.db, t, (tx) =>
          tx.insert(aiUsage).values({
            orgId: t.orgId,
            userId: t.userId,
            providerId: row.id,
            feature: input.feature,
            model: row.model,
            ok: false,
          }),
        );
        if (err instanceof AiError) throw new HttpError(502, 'ai_error', err.message);
        throw err;
      }
      await withTenant(deps.db, t, (tx) =>
        tx.insert(aiUsage).values({
          orgId: t.orgId,
          userId: t.userId,
          providerId: row.id,
          feature: input.feature,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        }),
      );
      return {
        output: parseOutput(input.feature, result.text),
        provider: { id: row.id, name: row.name, model: result.model },
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      };
    },
  );
}
