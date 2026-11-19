import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isPermission } from '@runflow/core';
import { withTenant, memberships, roles } from '@runflow/db';
import { and, eq } from 'drizzle-orm';
import { requireRundown } from '../services/rundowns';
import { CLOSE_FORBIDDEN, CLOSE_NOT_FOUND, CLOSE_UNAUTHORIZED } from '../collab/collab-server';
import type { AppDeps } from '../app';

const params = z.object({ rundownId: z.uuid() });

/**
 * WebSocket de colaboración: /api/collab/:rundownId
 * La autenticación usa la cookie de sesión. Se acepta la conexión y, si no
 * procede, se cierra con un código 44xx para que el cliente no reintente.
 */
export async function collabRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/collab/:rundownId', { websocket: true }, async (socket, req) => {
    const collab = deps.collab!;
    const pending = collab.buffer(socket);
    // Protección contra secuestro de WebSocket entre sitios: el navegador envía
    // la cookie aunque la página sea de otro origen, así que se exige el mismo.
    const origin = req.headers.origin;
    if (origin && req.headers.host && new URL(origin).host !== req.headers.host) {
      return socket.close(CLOSE_FORBIDDEN, 'Origen no permitido');
    }
    const parsed = params.safeParse(req.params);
    if (!parsed.success) return socket.close(CLOSE_NOT_FOUND, 'Escaleta no encontrada');
    const { rundownId } = parsed.data;

    const session = req.auth;
    if (!session || session.mustChangePassword) {
      return socket.close(CLOSE_UNAUTHORIZED, 'Inicia sesión');
    }
    if (!session.activeOrgId) return socket.close(CLOSE_FORBIDDEN, 'Elige una empresa');
    const ctx = { orgId: session.activeOrgId, userId: session.userId };

    try {
      const permissions = await withTenant(deps.db, ctx, async (tx) => {
        const [m] = await tx
          .select({ active: memberships.active, permissions: roles.permissions })
          .from(memberships)
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, ctx.userId)))
          .limit(1);
        if (!m?.active) return null;
        await requireRundown(tx, ctx.orgId, rundownId);
        return m.permissions.filter(isPermission);
      });
      if (!permissions || !permissions.includes('rundown.view')) {
        return socket.close(CLOSE_FORBIDDEN, 'Sin acceso');
      }
      const canEdit =
        permissions.includes('rundown.edit_cells') ||
        permissions.includes('rundown.edit_structure');
      await collab.handleConnection(socket, rundownId, { ...ctx, readOnly: !canEdit }, pending);
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) {
        return socket.close(CLOSE_NOT_FOUND, 'Escaleta no encontrada');
      }
      req.log.error({ err }, 'Error al conectar a la colaboración');
      socket.close(1011, 'Error interno');
    }
  });
}
