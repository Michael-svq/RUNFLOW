import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_SOCIAL_FEEDS,
  socialFeedInput,
  socialFeedPatch,
  socialGraphicFields,
  socialPostInput,
  socialPostsQuery,
  socialToRundown,
  type AutoNetwork,
  type SocialFeedDto,
  type SocialNetwork,
  type SocialPostDto,
  type SocialStatus,
} from '@runflow/core';
import { rundowns, socialFeeds, socialPosts, withTenant } from '@runflow/db';
import { appendBlocks, insertLine, readLines } from '@runflow/sync';
import { HttpError, forbidden, notFound, parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import { refreshSocialFeed, socialOptions } from '../social/poller';
import type { AppDeps } from '../app';

/* F3.4 Redes: búsquedas, moderación y rótulos de redes sociales. */

const idParams = z.object({ id: z.uuid() });

const feedDto = (r: typeof socialFeeds.$inferSelect): SocialFeedDto => ({
  id: r.id,
  network: r.network as AutoNetwork,
  query: r.query,
  instance: r.instance,
  hasKey: !!r.apiKeyEnc,
  enabled: r.enabled,
  lastFetchedAt: r.lastFetchedAt?.toISOString() ?? null,
  lastError: r.lastError,
});

const postDto = (r: typeof socialPosts.$inferSelect): SocialPostDto => ({
  id: r.id,
  feedId: r.feedId,
  network: r.network as SocialNetwork,
  author: r.author,
  handle: r.handle,
  text: r.text,
  url: r.url,
  mediaUrl: r.mediaUrl,
  postedAt: r.postedAt?.toISOString() ?? null,
  status: r.status as SocialStatus,
  createdAt: r.createdAt.toISOString(),
});

export async function socialRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'rundown.view');
  const configure = requirePermission(deps.db, 'program.configure');
  const org = requireOrg(deps.db);
  /** Moderan y rotulan quienes escriben en la escaleta. */
  const writer = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (
      !['templates.manage', 'rundown.edit_structure', 'script.edit_own', 'script.edit_any'].some(
        (x) => p.includes(x as never),
      )
    )
      throw forbidden();
  };
  const opts = () => socialOptions(deps.config);

  /* ---------- Búsquedas ---------- */

  app.get('/api/social/feeds', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(socialFeeds)
        .where(eq(socialFeeds.orgId, t.orgId))
        .orderBy(socialFeeds.createdAt),
    );
    return { feeds: rows.map(feedDto), max: MAX_SOCIAL_FEEDS };
  });

  app.post('/api/social/feeds', { preHandler: configure }, async (req, reply) => {
    const input = parse(socialFeedInput, req.body);
    const t = req.tenant!;
    if ((input.network === 'x' || input.network === 'youtube') && !input.apiKey)
      throw new HttpError(400, 'missing_key', 'Esta red necesita la clave de su API');
    const row = await withTenant(deps.db, t, async (tx) => {
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(socialFeeds)
        .where(eq(socialFeeds.orgId, t.orgId))) as [{ n: number }];
      if (n >= MAX_SOCIAL_FEEDS)
        throw new HttpError(
          409,
          'limit',
          `Como máximo ${MAX_SOCIAL_FEEDS} búsquedas: quita una para añadir otra`,
        );
      const [created] = await tx
        .insert(socialFeeds)
        .values({
          orgId: t.orgId,
          network: input.network,
          query: input.query,
          instance: input.network === 'mastodon' ? input.instance.replace(/\/+$/, '') : '',
          apiKeyEnc: input.apiKey ? deps.secrets!.encrypt(input.apiKey) : null,
          enabled: input.enabled,
        })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'social.feed.create',
        targetType: 'social_feed',
        targetId: created!.id,
      });
      return created!;
    });
    // Primera lectura al darla de alta (para ver si funciona).
    const result = await refreshSocialFeed(deps.db, deps.secrets!, row, opts());
    const [fresh] = await withTenant(deps.db, t, (tx) =>
      tx.select().from(socialFeeds).where(eq(socialFeeds.id, row.id)),
    );
    reply.status(201);
    return { feed: feedDto(fresh!), added: result.added };
  });

  app.patch('/api/social/feeds/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { apiKey, ...input } = parse(socialFeedPatch, req.body);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .update(socialFeeds)
        .set({
          ...input,
          ...(input.instance !== undefined ? { instance: input.instance.replace(/\/+$/, '') } : {}),
          ...(apiKey ? { apiKeyEnc: deps.secrets!.encrypt(apiKey) } : {}),
        })
        .where(and(eq(socialFeeds.id, id), eq(socialFeeds.orgId, t.orgId)))
        .returning(),
    );
    if (!row) throw notFound('Búsqueda no encontrada');
    return { feed: feedDto(row) };
  });

  app.delete('/api/social/feeds/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, async (tx) => {
      // Las publicaciones sin moderar de esa búsqueda se van con ella.
      await tx
        .delete(socialPosts)
        .where(
          and(
            eq(socialPosts.orgId, t.orgId),
            eq(socialPosts.feedId, id),
            eq(socialPosts.status, 'nuevo'),
          ),
        );
      return tx
        .delete(socialFeeds)
        .where(and(eq(socialFeeds.id, id), eq(socialFeeds.orgId, t.orgId)))
        .returning({ id: socialFeeds.id });
    });
    if (!rows[0]) throw notFound('Búsqueda no encontrada');
    return { ok: true };
  });

  app.post('/api/social/feeds/:id/refresh', { preHandler: writer }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(socialFeeds)
        .where(and(eq(socialFeeds.id, id), eq(socialFeeds.orgId, t.orgId))),
    );
    if (!row) throw notFound('Búsqueda no encontrada');
    return refreshSocialFeed(deps.db, deps.secrets!, row, opts());
  });

  /* ---------- Publicaciones ---------- */

  app.get('/api/social/posts', { preHandler: view }, async (req) => {
    const q = parse(socialPostsQuery, req.query);
    const t = req.tenant!;
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(socialPosts)
        .where(
          and(
            eq(socialPosts.orgId, t.orgId),
            q.status ? eq(socialPosts.status, q.status) : undefined,
            q.feedId ? eq(socialPosts.feedId, q.feedId) : undefined,
            like
              ? or(
                  ilike(socialPosts.text, like),
                  ilike(socialPosts.author, like),
                  ilike(socialPosts.handle, like),
                )
              : undefined,
          ),
        )
        .orderBy(desc(socialPosts.postedAt), desc(socialPosts.createdAt))
        .limit(q.limit),
    );
    const counts = await withTenant(deps.db, t, (tx) =>
      tx
        .select({ status: socialPosts.status, n: count() })
        .from(socialPosts)
        .where(eq(socialPosts.orgId, t.orgId))
        .groupBy(socialPosts.status),
    );
    return {
      posts: rows.map(postDto),
      counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    };
  });

  /** Publicación escrita a mano (WhatsApp, Instagram, llamadas…). */
  app.post('/api/social/posts', { preHandler: writer }, async (req, reply) => {
    const input = parse(socialPostInput, req.body);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .insert(socialPosts)
        .values({ orgId: t.orgId, ...input, postedAt: new Date() })
        .returning(),
    );
    reply.status(201);
    return { post: postDto(row!) };
  });

  app.patch('/api/social/posts/:id', { preHandler: writer }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { status } = parse(
      z.object({ status: z.enum(['nuevo', 'aprobado', 'descartado']) }),
      req.body,
    );
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .update(socialPosts)
        .set({ status })
        .where(and(eq(socialPosts.id, id), eq(socialPosts.orgId, t.orgId)))
        .returning(),
    );
    if (!row) throw notFound('Publicación no encontrada');
    return { post: postDto(row) };
  });

  app.delete('/api/social/posts/:id', { preHandler: writer }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(socialPosts)
        .where(and(eq(socialPosts.id, id), eq(socialPosts.orgId, t.orgId)))
        .returning({ id: socialPosts.id }),
    );
    if (!rows[0]) throw notFound('Publicación no encontrada');
    return { ok: true };
  });

  /**
   * Rotular: añade un rótulo RRS al guion de una línea (o a una línea nueva
   * de GRAFISMO al final) y deja la publicación aprobada.
   */
  app.post('/api/social/posts/:id/rundown', { preHandler: writer }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(socialToRundown, req.body);
    const t = req.tenant!;
    const [post, rundown] = await withTenant(deps.db, t, async (tx) => [
      (
        await tx
          .select()
          .from(socialPosts)
          .where(and(eq(socialPosts.id, id), eq(socialPosts.orgId, t.orgId)))
      )[0],
      (
        await tx
          .select({ id: rundowns.id })
          .from(rundowns)
          .where(
            and(
              eq(rundowns.id, input.rundownId),
              eq(rundowns.orgId, t.orgId),
              isNull(rundowns.deletedAt),
            ),
          )
      )[0],
    ]);
    if (!post) throw notFound('Publicación no encontrada');
    if (!rundown) throw notFound('Escaleta no encontrada');
    const fields = socialGraphicFields(postDto(post));
    const graphicId = randomUUID();
    const lineId = await deps.collab!.withDoc(rundown.id, t.orgId, (doc) => {
      let target = input.lineId;
      if (target) {
        if (!readLines(doc).some((l) => l.id === target)) throw notFound('Línea no encontrada');
      } else {
        target = insertLine(doc, {
          cells: { tipo: 'GRAFISMO', nombre: `RRSS ${post.handle || post.author}`.slice(0, 80) },
        });
      }
      appendBlocks(doc, target, [
        { kind: 'rotulo', id: graphicId, type: 'RRS', ...fields, tcIn: '', tcOut: '' },
      ]);
      return target;
    });
    await withTenant(deps.db, t, async (tx) => {
      await tx.update(socialPosts).set({ status: 'aprobado' }).where(eq(socialPosts.id, id));
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'social.post.rundown',
        targetType: 'social_post',
        targetId: id,
        data: { rundownId: rundown.id, lineId },
      });
    });
    reply.status(201);
    return { lineId, graphicId };
  });
}
