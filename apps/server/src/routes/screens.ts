import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  sceneInput,
  scenePatch,
  sceneKey,
  screenContentSchema,
  screenInput,
  screenPatch,
  type SceneDto,
  type ScreenContent,
  type ScreenDto,
} from '@runflow/core';
import { media, screenScenes, screens, withSystem, withTenant } from '@runflow/db';
import { HttpError, forbidden, notFound, parse, pgErrorCode } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import { sendRange } from './media';
import type { AppDeps } from '../app';

/* F3.3 Pantallas / videowall: pantallas, escenas y clientes a pantalla completa. */

const idParams = z.object({ id: z.uuid() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });
const newToken = () => randomBytes(24).toString('base64url');

const content = (v: unknown): ScreenContent => {
  const r = screenContentSchema.safeParse(v);
  return r.success ? r.data : { type: 'none' };
};
const screenDto = (r: typeof screens.$inferSelect): ScreenDto => ({
  id: r.id,
  name: r.name,
  token: r.token,
  content: content(r.content),
});
const sceneDto = (r: typeof screenScenes.$inferSelect): SceneDto => ({
  id: r.id,
  name: r.name,
  contents: Object.fromEntries(
    Object.entries((r.contents ?? {}) as Record<string, unknown>).map(([k, v]) => [k, content(v)]),
  ),
  active: r.active,
});

export async function screenRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'production.view');
  const org = requireOrg(deps.db);
  /** Configuran pantallas y escenas: producción o configuración de la empresa. */
  const manage = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (!p.includes('production.manage') && !p.includes('org.configure')) throw forbidden();
  };
  /** Lanzan escenas: quien da GO o producción. */
  const take = async (req: FastifyRequest, reply: FastifyReply) => {
    await org(req, reply);
    const p = req.tenant!.permissions;
    if (!p.includes('live.go') && !p.includes('production.manage')) throw forbidden();
  };
  const manager = () => deps.screens!;

  /** Los medios y las escenas tienen que ser de la empresa. */
  async function checkMedia(orgId: string, list: ScreenContent[]) {
    const ids = [...new Set(list.flatMap((c) => (c.type === 'media' ? [c.mediaId] : [])))];
    if (!ids.length) return;
    const found = await withSystem(deps.db, (tx) =>
      tx
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.orgId, orgId), inArray(media.id, ids))),
    );
    const own = new Set(found.map((f) => f.id));
    if (ids.some((id) => !own.has(id))) throw notFound('Fichero de Media no encontrado');
  }
  async function checkScreens(orgId: string, contents: Record<string, ScreenContent>) {
    const ids = Object.keys(contents);
    if (!ids.length) return;
    const rows = await withSystem(deps.db, (tx) =>
      tx.select({ id: screens.id }).from(screens).where(eq(screens.orgId, orgId)),
    );
    const own = new Set(rows.map((r) => r.id));
    if (ids.some((id) => !own.has(id))) throw notFound('Pantalla no encontrada');
  }

  app.get('/api/screens', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    return withTenant(deps.db, t, async (tx) => ({
      screens: (
        await tx
          .select()
          .from(screens)
          .where(eq(screens.orgId, t.orgId))
          .orderBy(asc(screens.createdAt))
      ).map(screenDto),
      scenes: (
        await tx
          .select()
          .from(screenScenes)
          .where(eq(screenScenes.orgId, t.orgId))
          .orderBy(asc(screenScenes.name))
      ).map(sceneDto),
      clients: manager().clients(t.orgId),
    }));
  });

  /* ---------- Pantallas ---------- */

  app.post('/api/screens', { preHandler: manage }, async (req, reply) => {
    const input = parse(screenInput, req.body);
    const t = req.tenant!;
    await checkMedia(t.orgId, [input.content]);
    const [row] = await withTenant(deps.db, t, async (tx) => {
      const created = await tx
        .insert(screens)
        .values({ orgId: t.orgId, name: input.name, content: input.content, token: newToken() })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'screen.create',
        targetType: 'screen',
        targetId: created[0]!.id,
      });
      return created;
    });
    reply.status(201);
    return { screen: screenDto(row!) };
  });

  app.patch('/api/screens/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(screenPatch, req.body);
    const t = req.tenant!;
    if (input.content) await checkMedia(t.orgId, [input.content]);
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .update(screens)
        .set(input)
        .where(and(eq(screens.id, id), eq(screens.orgId, t.orgId)))
        .returning(),
    );
    if (!row) throw notFound('Pantalla no encontrada');
    await manager().notify(t.orgId);
    return { screen: screenDto(row) };
  });

  /** Nuevo enlace: el anterior deja de funcionar. */
  app.post('/api/screens/:id/token', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .update(screens)
        .set({ token: newToken() })
        .where(and(eq(screens.id, id), eq(screens.orgId, t.orgId)))
        .returning(),
    );
    if (!row) throw notFound('Pantalla no encontrada');
    await manager().notify(t.orgId);
    return { screen: screenDto(row) };
  });

  app.delete('/api/screens/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(screens)
        .where(and(eq(screens.id, id), eq(screens.orgId, t.orgId)))
        .returning({ id: screens.id }),
    );
    if (!rows[0]) throw notFound('Pantalla no encontrada');
    await manager().notify(t.orgId);
    return { ok: true };
  });

  /* ---------- Escenas ---------- */

  const sceneConflict = (err: unknown) => {
    if (pgErrorCode(err) === '23505')
      throw new HttpError(409, 'duplicate', 'Ya hay una escena con ese nombre');
    throw err;
  };

  app.post('/api/screens/scenes', { preHandler: manage }, async (req, reply) => {
    const input = parse(sceneInput, req.body);
    const t = req.tenant!;
    await checkScreens(t.orgId, input.contents);
    await checkMedia(t.orgId, Object.values(input.contents));
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .insert(screenScenes)
        .values({
          orgId: t.orgId,
          name: input.name,
          key: sceneKey(input.name),
          contents: input.contents,
        })
        .returning(),
    ).catch(sceneConflict);
    reply.status(201);
    return { scene: sceneDto(row!) };
  });

  app.patch('/api/screens/scenes/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(scenePatch, req.body);
    const t = req.tenant!;
    if (input.contents) {
      await checkScreens(t.orgId, input.contents);
      await checkMedia(t.orgId, Object.values(input.contents));
    }
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .update(screenScenes)
        .set({ ...input, ...(input.name ? { key: sceneKey(input.name) } : {}) })
        .where(and(eq(screenScenes.id, id), eq(screenScenes.orgId, t.orgId)))
        .returning(),
    ).catch(sceneConflict);
    if (!row) throw notFound('Escena no encontrada');
    if (row.active) await manager().notify(t.orgId);
    return { scene: sceneDto(row) };
  });

  app.delete('/api/screens/scenes/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(screenScenes)
        .where(and(eq(screenScenes.id, id), eq(screenScenes.orgId, t.orgId)))
        .returning({ active: screenScenes.active }),
    );
    if (!rows[0]) throw notFound('Escena no encontrada');
    if (rows[0].active) await manager().notify(t.orgId);
    return { ok: true };
  });

  /** Lanzar una escena a mano. */
  app.post('/api/screens/scenes/:id/take', { preHandler: take }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    if (!(await manager().activate(t.orgId, id))) throw notFound('Escena no encontrada');
    await withTenant(deps.db, t, (tx) =>
      audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'screen.scene.take',
        targetType: 'screen_scene',
        targetId: id,
      }),
    );
    return { ok: true };
  });

  /** Todas las pantallas a su contenido por defecto. */
  app.post('/api/screens/release', { preHandler: take }, async (req) => {
    await manager().activate(req.tenant!.orgId, null);
    return { ok: true };
  });

  /* ---------- Cliente de pantalla (sin cuenta, por enlace) ---------- */

  async function byToken(token: string) {
    const [row] = await withSystem(deps.db, (tx) =>
      tx.select().from(screens).where(eq(screens.token, token)),
    );
    if (!row) throw notFound('Esta pantalla ya no existe o su enlace ha cambiado');
    return row;
  }

  app.get('/api/public/screens/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    const screen = await byToken(token);
    return { state: await manager().stateFor(screen.id) };
  });

  /** Cambios en vivo (Server-Sent Events). */
  app.get('/api/public/screens/:token/events', async (req, reply) => {
    const { token } = parse(tokenParams, req.params);
    const screen = await byToken(token);
    const first = await manager().stateFor(screen.id);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let lastToken = screen.token;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
      raw.end();
    };
    const send = (state: typeof first) => {
      if (closed) return;
      if (!state) {
        raw.write('event: gone\ndata: {}\n\n');
        return close();
      }
      raw.write(`data: ${JSON.stringify(state)}\n\n`);
    };
    const unsubscribe = manager().subscribe(screen.orgId, screen.id, async (state) => {
      // Enlace regenerado: este cliente deja de valer.
      const [now] = await withSystem(deps.db, (tx) =>
        tx.select({ token: screens.token }).from(screens).where(eq(screens.id, screen.id)),
      );
      if (!now || now.token !== lastToken) return send(null);
      lastToken = now.token;
      send(state);
    });
    const ping = setInterval(() => !closed && raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', close);
    send(first);
  });

  app.get('/api/public/screens/:token/media/:mediaId', async (req, reply) => {
    const { token, mediaId } = parse(tokenParams.extend({ mediaId: z.uuid() }), req.params);
    const screen = await byToken(token);
    const [row] = await withSystem(deps.db, (tx) =>
      tx
        .select()
        .from(media)
        .where(and(eq(media.id, mediaId), eq(media.orgId, screen.orgId))),
    );
    if (!row) throw notFound('Fichero no encontrado');
    return sendRange(
      reply,
      deps.media!.file(screen.orgId, row.fileName),
      row.mime,
      req.headers.range,
    );
  });
}
