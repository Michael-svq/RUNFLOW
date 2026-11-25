import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { cameraImagePatch, cameraMoveInput, cameraPresetInput } from '@runflow/core';
import type { AppDeps } from '../app';
import { requireAnyPermission } from '../auth/guards';
import { parse } from '../errors';

/* Control de cámara (Dirección TV): PTZ, imagen, balances, foco e imagen fija. */

const idParams = z.object({ id: z.string().uuid() });

export async function cameraRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const operate = requireAnyPermission(deps.db, 'live.go', 'devices.configure', 'org.configure');
  const cams = () => deps.cameras!;

  app.get('/api/cameras', { preHandler: operate }, async (req) => ({
    cameras: await cams().list(req.tenant!.orgId),
  }));

  app.post('/api/cameras/:id/move', { preHandler: operate }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { camera: await cams().move(req.tenant!.orgId, id, parse(cameraMoveInput, req.body)) };
  });

  app.post('/api/cameras/:id/preset', { preHandler: operate }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { action, slot } = parse(cameraPresetInput, req.body);
    return { camera: await cams().preset(req.tenant!.orgId, id, action, slot) };
  });

  app.patch('/api/cameras/:id/image', { preHandler: operate }, async (req) => {
    const { id } = parse(idParams, req.params);
    return { camera: await cams().image(req.tenant!.orgId, id, parse(cameraImagePatch, req.body)) };
  });

  app.post('/api/cameras/:id/balance', { preHandler: operate }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { kind } = parse(z.object({ kind: z.enum(['white', 'black']) }), req.body);
    return { camera: await cams().balance(req.tenant!.orgId, id, kind) };
  });

  app.post('/api/cameras/:id/focus', { preHandler: operate }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { mode } = parse(z.object({ mode: z.enum(['auto', 'manual', 'onepush']) }), req.body);
    return { camera: await cams().focus(req.tenant!.orgId, id, mode) };
  });

  app.get('/api/cameras/:id/snapshot', { preHandler: operate }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const img = await cams().snapshot(req.tenant!.orgId, id);
    return reply.header('cache-control', 'no-store').type(img.type).send(img.body);
  });
}
