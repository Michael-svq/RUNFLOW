import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import { and, asc, eq, ilike } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  casparConfigSchema,
  clipNameFor,
  mediaFolderSchema,
  mediaPatch,
  mediaQuery,
  type MediaDto,
} from '@runflow/core';
import { devices, media, withTenant } from '@runflow/db';
import { HttpError, notFound, parse } from '../errors';
import { requirePermission } from '../auth/guards';
import { audit } from '../services/audit';
import type { AppDeps } from '../app';

/* F2.1 Media: subida, organización, previsualización y copia a CasparCG. */

const idParams = z.object({ id: z.uuid() });
const ALLOWED = /^(video|image|audio)\//;
const EXT_RE = /\.([a-z0-9]{2,5})$/i;

type Row = typeof media.$inferSelect;

const toDto = (r: Row): MediaDto => ({
  id: r.id,
  folder: r.folder,
  name: r.name,
  mime: r.mime,
  size: r.size,
  durationS: r.durationS,
  width: r.width,
  height: r.height,
  proxyStatus: r.proxyStatus as MediaDto['proxyStatus'],
  createdAt: r.createdAt.toISOString(),
  clipName: clipNameFor(r.folder, r.name),
});

/** Envía un fichero con soporte de Range (para el reproductor del navegador). */
export async function sendRange(
  reply: FastifyReply,
  file: string,
  mime: string,
  range: string | undefined,
): Promise<FastifyReply> {
  const { size } = await stat(file);
  reply
    .header('accept-ranges', 'bytes')
    .header('cache-control', 'private, max-age=3600')
    .type(mime);
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      return reply.status(416).header('content-range', `bytes */${size}`).send();
    }
    return reply
      .status(206)
      .header('content-range', `bytes ${start}-${end}/${size}`)
      .header('content-length', end - start + 1)
      .send(createReadStream(file, { start, end }));
  }
  return reply.header('content-length', size).send(createReadStream(file));
}

export async function mediaRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'rundown.view');
  const manage = requirePermission(deps.db, 'media.manage');
  const store = () => deps.media!;
  const maxBytes = deps.config.mediaMaxMb * 1024 * 1024;

  await app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: maxBytes, files: 1, fields: 10 } });

    scope.post('/api/media', { preHandler: manage }, async (req, reply) => {
      const t = req.tenant!;
      const part = await req.file();
      if (!part) throw new HttpError(400, 'no_file', 'No se ha recibido ningún fichero');
      if (!ALLOWED.test(part.mimetype))
        throw new HttpError(415, 'bad_type', 'Solo vídeo, imagen o audio');
      const folderField = part.fields.folder as { value?: unknown } | undefined;
      const folder = mediaFolderSchema.parse(String(folderField?.value ?? ''));
      const id = randomUUID();
      const ext = (EXT_RE.exec(part.filename)?.[1] ?? 'bin').toLowerCase();
      const fileName = `${id}.${ext}`;
      await store().ensureDir(t.orgId);
      const target = store().file(t.orgId, fileName);
      await pipeline(part.file, createWriteStream(target));
      if (part.file.truncated) {
        await store().remove(t.orgId, id, fileName);
        throw new HttpError(413, 'too_large', `El fichero supera ${deps.config.mediaMaxMb} MB`);
      }
      const { size } = await stat(target);
      const probe = await store().probe(target);
      const isVideo = part.mimetype.startsWith('video/');
      const willProxy = isVideo && deps.config.mediaProxies;
      const [row] = await withTenant(deps.db, t, async (tx) => {
        const created = await tx
          .insert(media)
          .values({
            id,
            orgId: t.orgId,
            folder,
            name: part.filename.replace(EXT_RE, '').slice(0, 120) || 'Sin nombre',
            fileName,
            mime: part.mimetype,
            size,
            durationS: probe.durationS,
            width: probe.width,
            height: probe.height,
            proxyStatus: willProxy ? 'pending' : 'none',
            createdBy: t.userId,
          })
          .returning();
        await audit(tx, {
          orgId: t.orgId,
          userId: t.userId,
          action: 'media.upload',
          targetType: 'media',
          targetId: id,
        });
        return created;
      });
      if (willProxy) {
        void store()
          .makeProxy(target, store().proxy(t.orgId, id))
          .then((ok) =>
            withTenant(deps.db, t, (tx) =>
              tx
                .update(media)
                .set({ proxyStatus: ok ? 'ready' : 'error' })
                .where(eq(media.id, id)),
            ),
          )
          .catch(() => undefined);
      }
      reply.status(201);
      return { media: toDto(row!) };
    });
  });

  app.get('/api/media', { preHandler: view }, async (req) => {
    const q = parse(mediaQuery, req.query);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(media)
        .where(
          and(
            eq(media.orgId, t.orgId),
            q.folder !== undefined ? eq(media.folder, q.folder) : undefined,
            q.q ? ilike(media.name, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
          ),
        )
        .orderBy(asc(media.folder), asc(media.name))
        .limit(500),
    );
    const folders = await withTenant(deps.db, t, (tx) =>
      tx
        .selectDistinct({ folder: media.folder })
        .from(media)
        .where(eq(media.orgId, t.orgId))
        .orderBy(asc(media.folder)),
    );
    return { media: rows.map(toDto), folders: folders.map((f) => f.folder) };
  });

  app.patch('/api/media/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(mediaPatch, req.body);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .update(media)
        .set(input)
        .where(and(eq(media.id, id), eq(media.orgId, t.orgId)))
        .returning(),
    );
    if (!rows[0]) throw notFound('Media no encontrado');
    return { media: toDto(rows[0]) };
  });

  app.delete('/api/media/:id', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(deps.db, t, (tx) =>
      tx
        .delete(media)
        .where(and(eq(media.id, id), eq(media.orgId, t.orgId)))
        .returning(),
    );
    if (!rows[0]) throw notFound('Media no encontrado');
    await store().remove(t.orgId, id, rows[0].fileName);
    return { ok: true };
  });

  /** El fichero (o su proxy) con Range, para previsualizar. */
  app.get('/api/media/:id/file', { preHandler: view }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const proxy = (req.query as { proxy?: string }).proxy === '1';
    const t = req.tenant!;
    const [row] = await withTenant(deps.db, t, (tx) =>
      tx
        .select()
        .from(media)
        .where(and(eq(media.id, id), eq(media.orgId, t.orgId))),
    );
    if (!row) throw notFound('Media no encontrado');
    const useProxy = proxy && row.proxyStatus === 'ready';
    const file = useProxy ? store().proxy(t.orgId, id) : store().file(t.orgId, row.fileName);
    return sendRange(reply, file, useProxy ? 'video/mp4' : row.mime, req.headers.range);
  });

  /** Copia el vídeo a la carpeta de medios de un CasparCG. */
  app.post('/api/media/:id/casparcg', { preHandler: manage }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { deviceId } = parse(z.object({ deviceId: z.uuid() }), req.body);
    const t = req.tenant!;
    const [row, device] = await withTenant(deps.db, t, async (tx) => [
      (
        await tx
          .select()
          .from(media)
          .where(and(eq(media.id, id), eq(media.orgId, t.orgId)))
      )[0],
      (
        await tx
          .select()
          .from(devices)
          .where(and(eq(devices.id, deviceId), eq(devices.orgId, t.orgId)))
      )[0],
    ]);
    if (!row) throw notFound('Media no encontrado');
    if (!device || device.kind !== 'casparcg') throw notFound('CasparCG no encontrado');
    const config = casparConfigSchema.parse(device.config);
    if (!config.mediaPath)
      throw new HttpError(
        409,
        'no_media_path',
        'Indica en Configuración la carpeta de medios de este CasparCG',
      );
    const clipName = clipNameFor(row.folder, row.name);
    const ext = EXT_RE.exec(row.fileName)?.[1] ?? 'mp4';
    const target = path.join(config.mediaPath, ...clipName.split('/')) + `.${ext}`;
    const root = path.resolve(config.mediaPath);
    if (!path.resolve(target).startsWith(root + path.sep))
      throw new HttpError(400, 'bad_path', 'Ruta no válida');
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(store().file(t.orgId, row.fileName), target);
    } catch (err) {
      throw new HttpError(
        502,
        'copy_failed',
        `No se pudo copiar a CasparCG: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await withTenant(deps.db, t, (tx) =>
      audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'media.casparcg',
        targetType: 'media',
        targetId: id,
        data: { deviceId, clipName },
      }),
    );
    return { clipName };
  });
}
