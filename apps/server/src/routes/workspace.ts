import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as Y from 'yjs';
import { z } from 'zod';
import {
  ADMIN_ROLE_KEY,
  chatInput,
  fridgeInput,
  isPermission,
  roleInput,
  searchQuery,
  templateInput,
  versionInput,
  type ChatMessageDto,
  type FridgeItemDto,
  type Permission,
  type SearchResultDto,
  type TemplateDto,
  type TrashItemDto,
  type VersionDto,
} from '@runflow/core';
import { compactState, docFromState, readLines, replaceContent } from '@runflow/sync';
import {
  chatMessages,
  fridgeItems,
  memberships,
  programs,
  roles,
  rundownLines,
  rundowns,
  rundownTemplates,
  rundownVersions,
  withTenant,
} from '@runflow/db';
import { badRequest, conflict, forbidden, notFound, parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import { requireRundown } from '../services/rundowns';
import { audit } from '../services/audit';
import { MESSAGE_CHAT } from '../collab/collab-server';
import type { AppDeps } from '../app';

const idParams = z.object({ id: z.uuid() });
const versionParams = z.object({ id: z.uuid(), versionId: z.uuid() });
const chatQuery = z.object({ before: z.coerce.number().int().positive().optional() });

/*
 * M5 — colaboración y archivo: chat, papelera, búsqueda, plantillas, nevera,
 * historial de versiones y roles editables.
 */
export async function workspaceRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const db = deps.db;
  const view = requirePermission(db, 'rundown.view');
  const structure = requirePermission(db, 'rundown.edit_structure');
  const templates = requirePermission(db, 'templates.manage');
  const manageUsers = requirePermission(db, 'users.manage');
  const org = requireOrg(db);
  const anyOf =
    (...perms: Permission[]) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      await org(req, reply);
      if (!perms.some((p) => req.tenant!.permissions.includes(p))) throw forbidden();
    };

  /* ---------- Chat por escaleta ---------- */

  app.get('/api/rundowns/:id/chat', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { before } = parse(chatQuery, req.query);
    const t = req.tenant!;
    const rows = await withTenant(db, t, async (tx) => {
      await requireRundown(tx, t.orgId, id);
      return tx
        .select()
        .from(chatMessages)
        .where(
          and(eq(chatMessages.rundownId, id), before ? lt(chatMessages.id, before) : undefined),
        )
        .orderBy(desc(chatMessages.id))
        .limit(100);
    });
    const messages: ChatMessageDto[] = rows.reverse().map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.userName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));
    return { messages };
  });

  app.post(
    '/api/rundowns/:id/chat',
    { preHandler: view, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const { body } = parse(chatInput, req.body);
      const t = req.tenant!;
      const [row] = await withTenant(db, t, async (tx) => {
        await requireRundown(tx, t.orgId, id);
        return tx
          .insert(chatMessages)
          .values({
            orgId: t.orgId,
            rundownId: id,
            userId: t.userId,
            userName: req.auth!.name,
            body,
          })
          .returning();
      });
      const message: ChatMessageDto = {
        id: row!.id,
        userId: row!.userId,
        userName: row!.userName,
        body: row!.body,
        createdAt: row!.createdAt.toISOString(),
      };
      deps.collab?.broadcastCustom(id, MESSAGE_CHAT, message);
      reply.status(201);
      return { message };
    },
  );

  /* ---------- Papelera ---------- */

  app.get('/api/trash', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(db, t, (tx) =>
      tx
        .select({
          id: rundowns.id,
          title: rundowns.title,
          programName: programs.name,
          airDate: rundowns.airDate,
          deletedAt: rundowns.deletedAt,
        })
        .from(rundowns)
        .innerJoin(programs, eq(programs.id, rundowns.programId))
        .where(and(eq(rundowns.orgId, t.orgId), isNotNull(rundowns.deletedAt)))
        .orderBy(desc(rundowns.deletedAt)),
    );
    const items: TrashItemDto[] = rows.map((r) => ({
      ...r,
      deletedAt: r.deletedAt!.toISOString(),
    }));
    return { items };
  });

  app.post('/api/trash/:id/restore', { preHandler: structure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(db, t, async (tx) => {
      const r = await tx
        .update(rundowns)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(rundowns.id, id), eq(rundowns.orgId, t.orgId), isNotNull(rundowns.deletedAt)))
        .returning({ id: rundowns.id });
      if (r.length) {
        await audit(tx, {
          orgId: t.orgId,
          userId: t.userId,
          action: 'rundown.restore',
          targetType: 'rundown',
          targetId: id,
        });
      }
      return r;
    });
    if (!rows.length) throw notFound('No está en la papelera');
    return { ok: true };
  });

  app.delete('/api/trash/:id', { preHandler: structure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(db, t, async (tx) => {
      const r = await tx
        .delete(rundowns)
        .where(and(eq(rundowns.id, id), eq(rundowns.orgId, t.orgId), isNotNull(rundowns.deletedAt)))
        .returning({ id: rundowns.id });
      if (r.length) {
        await audit(tx, {
          orgId: t.orgId,
          userId: t.userId,
          action: 'rundown.purge',
          targetType: 'rundown',
          targetId: id,
        });
      }
      return r;
    });
    if (!rows.length) throw notFound('No está en la papelera');
    return { ok: true };
  });

  /* ---------- Búsqueda en el archivo ---------- */

  app.get('/api/search', { preHandler: view }, async (req) => {
    const { q } = parse(searchQuery, req.query);
    const t = req.tenant!;
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await withTenant(db, t, (tx) =>
      tx
        .select({
          rundownId: rundowns.id,
          rundownTitle: rundowns.title,
          airDate: rundowns.airDate,
          lineId: rundownLines.id,
          num: rundownLines.num,
          name: sql<string>`coalesce(${rundownLines.cells}->>'nombre', '')`,
        })
        .from(rundownLines)
        .innerJoin(rundowns, eq(rundowns.id, rundownLines.rundownId))
        .where(
          and(
            eq(rundowns.orgId, t.orgId),
            isNull(rundowns.deletedAt),
            or(ilike(sql`${rundownLines.cells}::text`, like), ilike(rundowns.title, like)),
          ),
        )
        .orderBy(desc(rundowns.airDate), asc(rundownLines.position))
        .limit(100),
    );
    const results: SearchResultDto[] = rows;
    return { results };
  });

  /* ---------- Plantillas ---------- */

  app.get('/api/templates', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(db, t, (tx) =>
      tx
        .select({
          id: rundownTemplates.id,
          name: rundownTemplates.name,
          description: rundownTemplates.description,
          lineCount: rundownTemplates.lineCount,
          createdAt: rundownTemplates.createdAt,
        })
        .from(rundownTemplates)
        .where(eq(rundownTemplates.orgId, t.orgId))
        .orderBy(asc(rundownTemplates.name)),
    );
    const list: TemplateDto[] = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    return { templates: list };
  });

  app.post('/api/rundowns/:id/save-as-template', { preHandler: templates }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const input = parse(templateInput, req.body);
    const t = req.tenant!;
    await withTenant(db, t, (tx) => requireRundown(tx, t.orgId, id));
    const { state, count } = await deps.collab!.withDoc(id, t.orgId, (doc) => ({
      state: compactState(doc, { clearStatus: true }),
      count: readLines(doc).length,
    }));
    const [row] = await withTenant(db, t, (tx) =>
      tx
        .insert(rundownTemplates)
        .values({
          orgId: t.orgId,
          name: input.name,
          description: input.description,
          ydoc: state,
          lineCount: count,
          createdBy: t.userId,
        })
        .returning(),
    );
    reply.status(201);
    const dto: TemplateDto = {
      id: row!.id,
      name: row!.name,
      description: row!.description,
      lineCount: row!.lineCount,
      createdAt: row!.createdAt.toISOString(),
    };
    return { template: dto };
  });

  app.delete('/api/templates/:id', { preHandler: templates }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(db, t, (tx) =>
      tx
        .delete(rundownTemplates)
        .where(and(eq(rundownTemplates.id, id), eq(rundownTemplates.orgId, t.orgId)))
        .returning({ id: rundownTemplates.id }),
    );
    if (!rows.length) throw notFound('Plantilla no encontrada');
    return { ok: true };
  });

  /* ---------- Nevera ---------- */

  app.get('/api/fridge', { preHandler: view }, async (req) => {
    const t = req.tenant!;
    const rows = await withTenant(db, t, (tx) =>
      tx
        .select()
        .from(fridgeItems)
        .where(eq(fridgeItems.orgId, t.orgId))
        .orderBy(desc(fridgeItems.createdAt)),
    );
    const items: FridgeItemDto[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      cells: r.cells as FridgeItemDto['cells'],
      script: r.script as unknown[],
      createdAt: r.createdAt.toISOString(),
    }));
    return { items };
  });

  app.post(
    '/api/fridge',
    {
      preHandler: anyOf(
        'templates.manage',
        'rundown.edit_structure',
        'script.edit_own',
        'script.edit_any',
      ),
    },
    async (req, reply) => {
      const input = parse(fridgeInput, req.body);
      const t = req.tenant!;
      const { estado: _estado, num: _num, ...cells } = input.cells;
      const [row] = await withTenant(db, t, (tx) =>
        tx
          .insert(fridgeItems)
          .values({
            orgId: t.orgId,
            name: input.name,
            cells,
            script: input.script,
            createdBy: t.userId,
          })
          .returning(),
      );
      reply.status(201);
      return {
        item: {
          id: row!.id,
          name: row!.name,
          cells,
          script: input.script,
          createdAt: row!.createdAt.toISOString(),
        },
      };
    },
  );

  app.delete(
    '/api/fridge/:id',
    { preHandler: anyOf('templates.manage', 'rundown.edit_structure') },
    async (req) => {
      const { id } = parse(idParams, req.params);
      const t = req.tenant!;
      const rows = await withTenant(db, t, (tx) =>
        tx
          .delete(fridgeItems)
          .where(and(eq(fridgeItems.id, id), eq(fridgeItems.orgId, t.orgId)))
          .returning({ id: fridgeItems.id }),
      );
      if (!rows.length) throw notFound('No está en la nevera');
      return { ok: true };
    },
  );

  /* ---------- Historial de versiones ---------- */

  app.get('/api/rundowns/:id/versions', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    const rows = await withTenant(db, t, async (tx) => {
      await requireRundown(tx, t.orgId, id);
      return tx
        .select({
          id: rundownVersions.id,
          kind: rundownVersions.kind,
          label: rundownVersions.label,
          lineCount: rundownVersions.lineCount,
          createdAt: rundownVersions.createdAt,
          createdBy: rundownVersions.createdBy,
        })
        .from(rundownVersions)
        .where(eq(rundownVersions.rundownId, id))
        .orderBy(desc(rundownVersions.createdAt))
        .limit(100);
    });
    const versions: VersionDto[] = rows.map((r) => ({
      ...r,
      kind: r.kind as VersionDto['kind'],
      createdAt: r.createdAt.toISOString(),
    }));
    return { versions };
  });

  const saveVersion = async (
    t: { orgId: string; userId: string },
    rundownId: string,
    doc: Y.Doc,
    kind: 'manual' | 'restore',
    label: string,
  ) => {
    await withTenant(db, t, (tx) =>
      tx.insert(rundownVersions).values({
        orgId: t.orgId,
        rundownId,
        ydoc: compactState(doc),
        lineCount: readLines(doc).length,
        kind,
        label,
        createdBy: t.userId,
      }),
    );
  };

  app.post(
    '/api/rundowns/:id/versions',
    { preHandler: anyOf('rundown.edit_cells', 'rundown.edit_structure') },
    async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const { label } = parse(versionInput, req.body);
      const t = req.tenant!;
      await withTenant(db, t, (tx) => requireRundown(tx, t.orgId, id));
      await deps.collab!.withDoc(id, t.orgId, (doc) => saveVersion(t, id, doc, 'manual', label));
      reply.status(201);
      return { ok: true };
    },
  );

  app.post(
    '/api/rundowns/:id/versions/:versionId/restore',
    { preHandler: structure },
    async (req) => {
      const { id, versionId } = parse(versionParams, req.params);
      const t = req.tenant!;
      const [version] = await withTenant(db, t, async (tx) => {
        await requireRundown(tx, t.orgId, id);
        return tx
          .select()
          .from(rundownVersions)
          .where(and(eq(rundownVersions.id, versionId), eq(rundownVersions.rundownId, id)))
          .limit(1);
      });
      if (!version) throw notFound('Versión no encontrada');
      await deps.collab!.withDoc(id, t.orgId, async (doc) => {
        // Antes de restaurar se guarda lo actual, para poder volver.
        await saveVersion(t, id, doc, 'restore', 'Antes de restaurar');
        replaceContent(doc, docFromState(version.ydoc), { origin: 'restore' });
      });
      await withTenant(db, t, (tx) =>
        audit(tx, {
          orgId: t.orgId,
          userId: t.userId,
          action: 'rundown.restore_version',
          targetType: 'rundown',
          targetId: id,
          data: { versionId },
        }),
      );
      return { ok: true };
    },
  );

  /* ---------- Roles editables ---------- */

  const cleanPermissions = (list: string[]): Permission[] => {
    const bad = list.filter((p) => !isPermission(p));
    if (bad.length)
      throw badRequest('validation', 'Revisa los datos del formulario', {
        permissions: `Permisos desconocidos: ${bad.join(', ')}`,
      });
    return [...new Set(list)] as Permission[];
  };

  app.post('/api/roles', { preHandler: manageUsers }, async (req, reply) => {
    const input = parse(roleInput, req.body);
    const t = req.tenant!;
    const permissions = cleanPermissions(input.permissions);
    const key = `custom_${Date.now().toString(36)}`;
    const [row] = await withTenant(db, t, (tx) =>
      tx
        .insert(roles)
        .values({
          orgId: t.orgId,
          key,
          name: input.name,
          description: input.description,
          permissions,
        })
        .returning(),
    );
    reply.status(201);
    return {
      role: {
        id: row!.id,
        key: row!.key,
        name: row!.name,
        description: row!.description,
        permissions,
        isSystem: false,
      },
    };
  });

  app.patch('/api/roles/:id', { preHandler: manageUsers }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(roleInput, req.body);
    const t = req.tenant!;
    const permissions = cleanPermissions(input.permissions);
    const row = await withTenant(db, t, async (tx) => {
      const [current] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.id, id), eq(roles.orgId, t.orgId)))
        .limit(1);
      if (!current) throw notFound('Rol no encontrado');
      if (current.key === ADMIN_ROLE_KEY)
        throw conflict('admin_role', 'El rol de administrador no se puede modificar');
      const [updated] = await tx
        .update(roles)
        .set({
          name: input.name,
          description: input.description,
          permissions,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, id))
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'role.update',
        targetType: 'role',
        targetId: id,
        data: { permissions },
      });
      return updated!;
    });
    return {
      role: {
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        permissions,
        isSystem: row.isSystem,
      },
    };
  });

  app.delete('/api/roles/:id', { preHandler: manageUsers }, async (req) => {
    const { id } = parse(idParams, req.params);
    const t = req.tenant!;
    await withTenant(db, t, async (tx) => {
      const [current] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.id, id), eq(roles.orgId, t.orgId)))
        .limit(1);
      if (!current) throw notFound('Rol no encontrado');
      if (current.key === ADMIN_ROLE_KEY)
        throw conflict('admin_role', 'El rol de administrador no se puede borrar');
      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(inArray(memberships.roleId, [id]));
      if ((used?.n ?? 0) > 0)
        throw conflict(
          'role_in_use',
          'Hay usuarios con este rol: cámbiales el rol antes de borrarlo',
        );
      await tx.delete(roles).where(eq(roles.id, id));
    });
    return { ok: true };
  });
}
