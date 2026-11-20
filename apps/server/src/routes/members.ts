import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUserInput, resetPasswordInput, updateUserInput } from '@runflow/core';
import { parse } from '../errors';
import { requireOrg, requirePermission } from '../auth/guards';
import {
  createMember,
  listMembers,
  listRoles,
  removeMember,
  resetMemberPassword,
  updateMember,
} from '../services/members';
import type { AppDeps } from '../app';
import { assertPlan } from '../services/plans';

const userIdParams = z.object({ userId: z.uuid() });

export async function memberRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const manage = requirePermission(deps.db, 'users.manage');

  app.get('/api/users', { preHandler: manage }, async (req) => {
    return { members: await listMembers(deps.db, req.tenant!) };
  });

  app.post('/api/users', { preHandler: manage }, async (req, reply) => {
    const input = parse(createUserInput, req.body);
    await assertPlan(deps.db, deps.config.planLimits, req.tenant!, 'users');
    const result = await createMember(deps.db, req.tenant!, input);
    reply.status(201);
    return result;
  });

  app.patch('/api/users/:userId', { preHandler: manage }, async (req) => {
    const { userId } = parse(userIdParams, req.params);
    const input = parse(updateUserInput, req.body);
    return { member: await updateMember(deps.db, req.tenant!, userId, input) };
  });

  app.post('/api/users/:userId/password', { preHandler: manage }, async (req) => {
    const { userId } = parse(userIdParams, req.params);
    const { password } = parse(resetPasswordInput, req.body);
    await resetMemberPassword(deps.db, req.tenant!, userId, password);
    return { ok: true };
  });

  app.delete('/api/users/:userId', { preHandler: manage }, async (req) => {
    const { userId } = parse(userIdParams, req.params);
    await removeMember(deps.db, req.tenant!, userId);
    return { ok: true };
  });

  // Cualquier miembro puede ver los roles de su empresa (para mostrar nombres y permisos).
  app.get('/api/roles', { preHandler: requireOrg(deps.db) }, async (req) => {
    return { roles: await listRoles(deps.db, req.tenant!) };
  });
}
