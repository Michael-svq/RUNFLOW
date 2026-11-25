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
import { LiveManager } from './live/live-manager';
import { liveRoutes } from './routes/live';
import { peopleRoutes } from './routes/people';
import { outputRoutes } from './routes/outputs';
import { workspaceRoutes } from './routes/workspace';
import { stationRoutes } from './routes/stations';
import { StationSync } from './station/sync-worker';
import { LicenseManager } from './station/license';
import { CgManager } from './cg/cg-manager';
import { MixerManager } from './mixers/mixer-manager';
import { SecretBox } from './services/secrets';
import { aiRoutes } from './routes/ai';
import { billingRoutes } from './routes/billing';
import { sourceRoutes } from './routes/sources';
import { publicApiRoutes } from './routes/public-api';
import { mediaRoutes } from './routes/media';
import { productionRoutes } from './routes/production';
import { budgetRoutes } from './routes/budget';
import { screenRoutes } from './routes/screens';
import { emailRoutes } from './routes/email';
import { Mailer } from './services/mailer';
import { setRequireEmailVerification } from './auth/guards';
import { socialRoutes } from './routes/social';
import { SocialPoller, socialOptions } from './social/poller';
import { ScreensManager } from './screens/manager';
import { CueRunner } from './automation/cue-runner';
import { LightingManager } from './lighting/manager';
import { SystemsManager } from './systems/manager';
import { CameraManager } from './cameras/manager';
import { cameraRoutes } from './routes/cameras';
import { CUE_TRACK_KEYS } from '@runflow/core';
import { MediaStore } from './media/store';
import { WebhookDispatcher } from './api/webhooks';
import { SourcePoller } from './sources/poller';
import { cgRoutes } from './routes/cg';
import { readFileSync } from 'node:fs';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  version: string;
  /** Los crea buildApp. */
  collab?: CollabServer;
  live?: LiveManager;
  /** Solo en una Station enlazada con la nube (modo híbrido). */
  stationSync?: StationSync;
  /** Solo en una Station. */
  license?: LicenseManager;
  cg?: CgManager;
  mixers?: MixerManager;
  /** Cifrado de secretos (claves de IA). */
  secrets?: SecretBox;
  /** Lectura periódica de fuentes RSS (la arranca index.ts). */
  sources?: SourcePoller;
  webhooks?: WebhookDispatcher;
  media?: MediaStore;
  screens?: ScreensManager;
  cues?: CueRunner;
  lighting?: LightingManager;
  systems?: SystemsManager;
  cameras?: CameraManager;
  mailer?: Mailer;
  social?: SocialPoller;
}

/** Cabecera que la web envía en toda petición que modifica datos (defensa CSRF). */
export const CSRF_HEADER = 'x-runflow-request';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Rutas que funcionan aunque la licencia de la Station haya caducado. */
const LICENSE_FREE = ['/api/auth/', '/api/setup', '/api/station/license', '/api/me/password'];

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
    ...(deps.config.tls
      ? {
          https: {
            cert: readFileSync(deps.config.tls.certFile),
            key: readFileSync(deps.config.tls.keyFile),
          },
        }
      : {}),
  }) as unknown as FastifyInstance;

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024 } });
  deps.collab = new CollabServer(deps.db, app.log);
  deps.live = new LiveManager(deps.db, deps.collab, app.log, {
    minGoIntervalMs: deps.config.minGoIntervalMs,
  });
  deps.secrets = await SecretBox.load({
    secretKey: deps.config.secretKey,
    dataDir: deps.config.dataDir,
  });
  deps.cg = new CgManager(deps.db, deps.collab, app.log, {
    serverBaseUrl:
      deps.config.publicUrl ?? `http${deps.config.tls ? 's' : ''}://127.0.0.1:${deps.config.port}`,
  });
  deps.mixers = new MixerManager(deps.db, deps.collab, app.log);
  // Con cada cambio del directo: CasparCG y mezcladores a la vez.
  deps.mailer = new Mailer({ smtpUrl: deps.config.smtpUrl, from: deps.config.mailFrom }, app.log);
  setRequireEmailVerification(deps.config.requireEmailVerification);
  deps.screens = new ScreensManager(deps.db, deps.collab, app.log);
  // F4.2 Automatización: cues del timeline ejecutados en directo.
  deps.cues = new CueRunner(deps.collab, app.log);
  const cutCue = async (ctx: {
    rundownId: string;
    orgId: string;
    lineId: string;
    cue: { target: string; label: string };
  }) => {
    const source = (ctx.cue.target || ctx.cue.label).trim();
    if (!source) throw new Error('El cue no dice a qué fuente cortar');
    await deps.mixers!.cutSource(ctx.rundownId, ctx.orgId, ctx.lineId, source);
    return true;
  };
  deps.lighting = new LightingManager(deps.db, app.log);
  deps.cues.executors.luces = async ({ orgId, cue }) =>
    (await deps.lighting!.fire(orgId, cue.target || cue.label, cue.duration)) > 0;
  deps.cues.executors.camara = cutCue;
  deps.cues.executors.vtr = cutCue;
  deps.cues.executors.rotulos = async ({ rundownId, orgId, cue, graphics }) => {
    const ref = (cue.target || '1').trim();
    const n = /^\d+$/.test(ref) ? Number(ref) : 0;
    const graphic = n ? graphics[n - 1] : graphics.find((g) => g.id === ref);
    if (!graphic) throw new Error(`No hay rótulo ${ref} en el guion de la línea`);
    const actor = { orgId, userId: '' };
    await deps.cg!.take(actor, rundownId, graphic.id);
    if (cue.duration > 0) {
      setTimeout(
        () => void deps.cg!.out(actor, rundownId, graphic.id).catch(() => undefined),
        cue.duration * 1000,
      ).unref?.();
    }
    return true;
  };
  // F4.4 Otros sistemas: reciben los cues de las pistas que tengan asignadas.
  deps.systems = new SystemsManager(deps.db, {
    allowPrivate: deps.config.sourcesAllowPrivate || deps.config.env === 'test',
  });
  // Cámaras PTZ: en una Station están en la red del estudio.
  deps.cameras = new CameraManager(deps.db, app.log, {
    allowPrivate:
      deps.config.sourcesAllowPrivate ||
      deps.config.env === 'test' ||
      deps.config.mode === 'station',
  });
  for (const track of CUE_TRACK_KEYS) {
    const builtin = deps.cues.executors[track];
    deps.cues.executors[track] = async (ctx) => {
      const errors: string[] = [];
      let done = false;
      if (builtin) {
        try {
          done = (await builtin(ctx)) || done;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      try {
        done = (await deps.systems!.fire(ctx.orgId, track, ctx.cue)) > 0 || done;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      if (errors.length) throw new Error(errors.join(' · '));
      return done;
    };
  }
  deps.webhooks = new WebhookDispatcher(deps.db, () => deps.secrets!, deps.collab, app.log, {
    allowPrivate: deps.config.sourcesAllowPrivate || deps.config.env === 'test',
  });
  deps.cg.onGraphic = (rundownId, orgId, event, data) =>
    deps.webhooks!.emit(orgId, event === 'in' ? 'graphic.in' : 'graphic.out', {
      rundownId,
      ...data,
    });
  deps.live.onChange = (rundownId, orgId, prev, next) => {
    const goAt = Date.now();
    deps.mixers!.onLive(rundownId, orgId, prev, next, goAt);
    deps.cg!.onLive(rundownId, orgId, prev, next);
    deps.webhooks!.onLive(rundownId, orgId, prev, next);
    deps.screens!.onLive(rundownId, orgId, prev, next);
    deps.cues!.onLive(rundownId, orgId, prev, next);
  };
  const { mode, cloudUrl, stationToken } = deps.config;
  if (mode === 'station' && cloudUrl && stationToken) {
    deps.stationSync = new StationSync(deps.db, deps.collab, app.log, {
      cloudUrl: cloudUrl.replace(/\/+$/, ''),
      token: stationToken,
      intervalMs: deps.config.stationSyncIntervalMs,
      version: deps.version,
      onConfigChanged: (orgId) => {
        void deps.cg!.invalidate(orgId);
        void deps.mixers!.invalidate(orgId);
        void deps.lighting?.invalidate(orgId);
        deps.systems?.invalidate(orgId);
        deps.cameras?.invalidate(orgId);
      },
    });
  }
  if (mode === 'station') {
    deps.license = new LicenseManager(
      deps.config.dataDir,
      deps.config.licensePublicKey,
      !!deps.stationSync,
    );
    await deps.license.load();
  }
  app.addHook('onClose', async () => {
    await deps.stationSync?.close();
    deps.cg!.close();
    deps.mixers!.close();
    deps.sources?.close();
    deps.social?.close();
    deps.cues?.close();
    deps.lighting?.close();
    deps.systems?.close();
    deps.cameras?.close();
    deps.live!.close();
    await deps.collab!.close();
  });
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
    // El mando por enlace (Companion, Stream Deck) no usa cookies: su token es la credencial.
    const tokenOnly =
      req.url.startsWith('/api/public/control/') ||
      req.url.startsWith('/api/billing/webhook') ||
      req.url.startsWith('/api/v1/');
    if (!SAFE_METHODS.has(req.method)) {
      // Una cabecera propia obliga a una petición de origen cruzado a pasar el
      // control CORS (que no permitimos), así que bloquea CSRF.
      if (!tokenOnly && req.headers[CSRF_HEADER] !== '1') {
        throw new HttpError(403, 'csrf', 'Petición no permitida');
      }
      const origin = req.headers.origin;
      if (!tokenOnly && origin && req.headers.host && new URL(origin).host !== req.headers.host) {
        throw new HttpError(403, 'csrf', 'Petición no permitida');
      }
      // Station sin licencia en vigor: solo consulta (se puede entrar y poner la licencia).
      if (
        deps.license &&
        !deps.license.status().writable &&
        !LICENSE_FREE.some((p) => req.url.startsWith(p))
      ) {
        throw new HttpError(402, 'license_expired', deps.license.status().message);
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
    if (deps.config.env === 'test') console.error(err);
    return reply.status(500).send(errorBody('internal', 'Error interno del servidor'));
  });

  await systemRoutes(app, deps);
  await authRoutes(app, deps);
  await memberRoutes(app, deps);
  await platformRoutes(app, deps);
  await rundownRoutes(app, deps);
  await collabRoutes(app, deps);
  await liveRoutes(app, deps);
  await peopleRoutes(app, deps);
  await outputRoutes(app, deps);
  await workspaceRoutes(app, deps);
  await stationRoutes(app, deps);
  await cgRoutes(app, deps);
  await aiRoutes(app, deps);
  await billingRoutes(app, deps);
  await sourceRoutes(app, deps);
  await publicApiRoutes(app, deps);
  deps.media = new MediaStore(deps.config.dataDir);
  await mediaRoutes(app, deps);
  await productionRoutes(app, deps);
  await budgetRoutes(app, deps);
  await screenRoutes(app, deps);
  await emailRoutes(app, deps);
  await socialRoutes(app, deps);
  await cameraRoutes(app, deps);
  deps.social = new SocialPoller(deps.db, () => deps.secrets!, app.log, {
    ...socialOptions(deps.config),
    allowPrivate: deps.config.sourcesAllowPrivate,
    intervalMs: deps.config.socialPollMs,
  });
  deps.sources = new SourcePoller(deps.db, app.log, {
    intervalMs: deps.config.sourcesPollMs,
    allowPrivate: deps.config.sourcesAllowPrivate,
  });

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
