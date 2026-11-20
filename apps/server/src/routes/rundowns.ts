import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createProgramInput,
  createRundownInput,
  listRundownsQuery,
  saveViewInput,
  updateProgramInput,
  updateRundownInput,
} from '@runflow/core';
import { parse } from '../errors';
import { requirePermission } from '../auth/guards';
import {
  createProgram,
  createRundown,
  createView,
  deleteRundown,
  deleteView,
  getRundown,
  listPrograms,
  listRundowns,
  listViews,
  updateProgram,
  updateRundown,
  updateView,
} from '../services/rundowns';
import type { AppDeps } from '../app';
import { assertPlan } from '../services/plans';

const idParams = z.object({ id: z.uuid() });

export async function rundownRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const view = requirePermission(deps.db, 'rundown.view');
  const configure = requirePermission(deps.db, 'program.configure');
  const structure = requirePermission(deps.db, 'rundown.edit_structure');

  // Programas
  app.get('/api/programs', { preHandler: view }, async (req) => ({
    programs: await listPrograms(deps.db, req.tenant!),
  }));
  app.post('/api/programs', { preHandler: configure }, async (req, reply) => {
    const input = parse(createProgramInput, req.body);
    await assertPlan(deps.db, deps.config.planLimits, req.tenant!, 'programs');
    reply.status(201);
    return { program: await createProgram(deps.db, req.tenant!, input) };
  });
  app.patch('/api/programs/:id', { preHandler: configure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(updateProgramInput, req.body);
    return { program: await updateProgram(deps.db, req.tenant!, id, input) };
  });

  // Escaletas
  app.get('/api/rundowns', { preHandler: view }, async (req) => {
    const filter = parse(listRundownsQuery, req.query);
    return { rundowns: await listRundowns(deps.db, req.tenant!, filter) };
  });
  app.post('/api/rundowns', { preHandler: structure }, async (req, reply) => {
    const input = parse(createRundownInput, req.body);
    reply.status(201);
    return { rundown: await createRundown(deps.db, req.tenant!, input) };
  });
  app.get('/api/rundowns/:id', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { rundown: await getRundown(deps.db, req.tenant!, id) };
  });
  app.patch('/api/rundowns/:id', { preHandler: structure }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(updateRundownInput, req.body);
    const rundown = await updateRundown(deps.db, req.tenant!, id, input);
    if (input.airDate || input.startTime || input.endTime) await deps.live?.refreshWindow(id);
    return { rundown };
  });
  app.delete('/api/rundowns/:id', { preHandler: structure }, async (req) => {
    const { id } = parse(idParams, req.params);
    await deleteRundown(deps.db, req.tenant!, id);
    deps.collab?.closeDocument(id);
    deps.live?.forget(id);
    return { ok: true };
  });

  // Vistas guardadas
  app.get('/api/views', { preHandler: view }, async (req) => ({
    views: await listViews(deps.db, req.tenant!),
  }));
  app.post('/api/views', { preHandler: view }, async (req, reply) => {
    const input = parse(saveViewInput, req.body);
    reply.status(201);
    return { view: await createView(deps.db, req.tenant!, input) };
  });
  app.patch('/api/views/:id', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(saveViewInput, req.body);
    return { view: await updateView(deps.db, req.tenant!, id, input) };
  });
  app.delete('/api/views/:id', { preHandler: view }, async (req) => {
    const { id } = parse(idParams, req.params);
    await deleteView(deps.db, req.tenant!, id);
    return { ok: true };
  });
}
