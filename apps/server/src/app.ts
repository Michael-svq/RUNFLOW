import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '@runflow/db';
import type { ApiErrorBody } from '@runflow/core';
import type { AppConfig } from './config';
import { HttpError, pgErrorCode } from './errors';
import { resolveSession, SESSION_COOKIE } from './auth/sessions';
import { systemRoutes } from './routes/system';
import { authRoutes } from './routes/auth';
import { memberRoutes } from './routes/members';
import { platformRoutes } from './routes/platform';
import { rundownRoutes } from './routes/rundowns';
import { collabRoutes } from './routes/collab';
import { CollabServer } from './collab/collab-server';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  version: string;
  /** Lo crea buildApp. */
  collab?: CollabServer;
}

/** Cabecera que la web envía en toda petición que modifica datos (defensa CSRF). */
export const CSRF_HEADER = 'x-runflow-request';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function errorBody(code: string, message: string, fields?: Record<string, string>): ApiErrorBody {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.config.env === 'test'
        ? false
        : {
            level: deps.config.logLevel,
            redact: ['req.headers.cookie', 'req.headers.authorization'],
          },
    trustProxy: deps.config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024 } });
  deps.collab = new CollabServer(deps.db, app.log);
  app.addHook('onClose', async () => deps.collab!.close());
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: ctx.statusCode,
      ...errorBody('rate_limited', 'Demasiados intentos. Espera un momento y vuelve a probar.'),
    }),
  });

  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!SAFE_METHODS.has(req.method)) {
      // Una cabecera propia obliga a una petición de origen cruzado a pasar el
      // control CORS (que no permitimos), así que bloquea CSRF.
      if (req.headers[CSRF_HEADER] !== '1') {
        throw new HttpError(403, 'csrf', 'Petición no permitida');
      }
      const origin = req.headers.origin;
      if (origin && req.headers.host && new URL(origin).host !== req.headers.host) {
        throw new HttpError(403, 'csrf', 'Petición no permitida');
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      req.auth = await resolveSession(deps.db, token, deps.config.sessionTtlDays);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send(errorBody(err.code, err.message, err.fields));
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.status(429).send(err);
    }
    if (pgErrorCode(err) === '23505') {
      return reply.status(409).send(errorBody('duplicate', 'Ya existe un registro con esos datos'));
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send(errorBody('bad_request', 'Petición no válida'));
    }
    req.log.error(err);
    return reply.status(500).send(errorBody('internal', 'Error interno del servidor'));
  });

  await systemRoutes(app, deps);
  await authRoutes(app, deps);
  await memberRoutes(app, deps);
  await platformRoutes(app, deps);
  await rundownRoutes(app, deps);
  await collabRoutes(app, deps);

  const webDist = deps.config.webDist ? path.resolve(deps.config.webDist) : undefined;
  const serveWeb = !!webDist && existsSync(path.join(webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webDist!,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (
          name === 'index.html' ||
          name === 'sw.js' ||
          name.startsWith('workbox-') ||
          name.endsWith('.webmanifest')
        ) {
          res.header('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !serveWeb || req.method !== 'GET') {
      return reply.status(404).send(errorBody('not_found', 'No encontrado'));
    }
    // Aplicación de una sola página: cualquier ruta devuelve index.html.
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return app;
}
