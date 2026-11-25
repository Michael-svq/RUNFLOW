import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { insertLine, writeScript, type ScriptBlock } from '@runflow/sync';
import { and, eq, sql } from 'drizzle-orm';
import { devices, memberships, roles, users, withSystem } from '@runflow/db';
import { hashPassword } from '../auth/password';
import type { AppDeps } from '../app';

/*
 * Datos de ejemplo para el estudio virtual (DEMO_SEED=true): una empresa con
 * su administración, el CasparCG y el OBS virtuales ya configurados y una
 * escaleta de hoy con guion, rótulos y vídeos lista para dar GO.
 * Solo se ejecuta si la instalación está vacía.
 */

export const DEMO_ACCOUNT = { email: 'demo@runflow.test', password: 'runflow-demo' };

/** Una cuenta por área de trabajo (misma contraseña que la de administración). */
export const DEMO_USERS = [
  { email: 'redac@runflow.test', name: 'Redacción', role: 'redactor' },
  { email: 'dirtv@runflow.test', name: 'Dirección TV', role: 'direccion_tv' },
  { email: 'produ@runflow.test', name: 'Producción', role: 'produccion' },
] as const;

/**
 * Crea (si faltan) las cuentas de Redacción, Dirección TV y Producción en la
 * empresa de la cuenta demo. Se ejecuta en cada arranque del estudio virtual,
 * así también llegan a instalaciones creadas antes.
 */
export async function ensureDemoUsers(deps: AppDeps): Promise<number> {
  return withSystem(deps.db, async (tx) => {
    const [admin] = await tx
      .select({ orgId: memberships.orgId })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(sql`lower(${users.email}) = ${DEMO_ACCOUNT.email}`)
      .limit(1);
    if (!admin) return 0;
    let created = 0;
    for (const u of DEMO_USERS) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.orgId, admin.orgId), eq(roles.key, u.role)));
      if (!role) continue;
      let [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${u.email}`);
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            email: u.email,
            name: u.name,
            passwordHash: await hashPassword(DEMO_ACCOUNT.password),
            mustChangePassword: false,
            emailVerifiedAt: new Date(),
          })
          .returning({ id: users.id });
        created++;
      }
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.orgId, admin.orgId), eq(memberships.userId, user!.id)));
      if (!member) {
        await tx
          .insert(memberships)
          .values({ orgId: admin.orgId, userId: user!.id, roleId: role.id });
      }
    }
    return created;
  });
}

/**
 * Dos cámaras PTZ simuladas para Control de cámara (si la empresa demo no tiene
 * ninguna cámara). Devuelve cuántas crea.
 */
export async function ensureDemoCameras(deps: AppDeps): Promise<number> {
  const created = await withSystem(deps.db, async (tx) => {
    const [admin] = await tx
      .select({ orgId: memberships.orgId })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(sql`lower(${users.email}) = ${DEMO_ACCOUNT.email}`)
      .limit(1);
    if (!admin) return { orgId: null, count: 0 };
    const existing = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.orgId, admin.orgId), eq(devices.kind, 'camera')));
    if (existing.length) return { orgId: admin.orgId, count: 0 };
    const config = { protocol: 'simulated', host: '', port: 0, address: 1, snapshotUrl: '' };
    await tx.insert(devices).values([
      { orgId: admin.orgId, name: 'CAM 1', kind: 'camera', enabled: true, config },
      { orgId: admin.orgId, name: 'CAM 2', kind: 'camera', enabled: true, config },
    ]);
    return { orgId: admin.orgId, count: 2 };
  });
  if (created.orgId) deps.cameras?.invalidate(created.orgId);
  return created.count;
}

const rotulo = (type: string, f0: string, f1 = '', tcIn = '', tcOut = ''): ScriptBlock => ({
  kind: 'rotulo',
  id: randomUUID(),
  type,
  f0,
  f1,
  f2: '',
  f3: '',
  tcIn,
  tcOut,
});

/** Fecha y hora de ahora en la zona de la empresa. */
function nowIn(timeZone: string): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export async function seedDemo(
  app: FastifyInstance,
  deps: AppDeps,
  opts: { studioHost: string; runflowUrl: string },
): Promise<boolean> {
  const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
  if (!status.json<{ needsSetup: boolean }>().needsSetup) return false;

  const headers: Record<string, string> = { 'x-runflow-request': '1' };
  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    headers,
    payload: { orgName: 'Estudio de pruebas', name: 'Demo', ...DEMO_ACCOUNT },
  });
  if (setup.statusCode !== 200) throw new Error(`Demo: ${setup.statusCode} ${setup.body}`);
  const cookie = setup.cookies.find((c) => c.name === 'rf_session')!;
  headers.cookie = `rf_session=${cookie.value}`;
  const orgId = setup.json<{ activeOrg: { id: string } }>().activeOrg.id;
  const call = async <T>(method: 'POST' | 'PATCH', url: string, payload: unknown): Promise<T> => {
    const res = await app.inject({ method, url, headers, payload: payload as object });
    if (res.statusCode >= 400) throw new Error(`Demo ${url}: ${res.statusCode} ${res.body}`);
    return res.json<T>();
  };

  // Equipos del estudio virtual.
  await call('POST', '/api/devices', {
    name: 'CasparCG (estudio virtual)',
    kind: 'casparcg',
    config: {
      host: opts.studioHost,
      port: 5250,
      oscPort: 6250,
      templateBaseUrl: opts.runflowUrl,
    },
  });
  await call('POST', '/api/devices', {
    name: 'OBS (estudio virtual)',
    kind: 'obs',
    config: {
      host: opts.studioHost,
      port: 4455,
      sources: { 'CAM 1': 'CAM 1', 'CAM 2': 'CAM 2', 'CAM 3': 'CAM 3', VTR: 'VTR' },
    },
  });

  // Escaleta de hoy, empezando ahora.
  const { program } = await call<{ program: { id: string } }>('POST', '/api/programs', {
    name: 'Informativo de prueba',
    type: 'informativo',
  });
  const now = nowIn('Europe/Madrid');
  const start = now.hour * 60 + Math.floor(now.minute / 5) * 5;
  const end = Math.min(start + 30, 23 * 60 + 59);
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const { rundown } = await call<{ rundown: { id: string } }>('POST', '/api/rundowns', {
    programId: program.id,
    title: 'Informativo de prueba',
    airDate: now.date,
    startTime: hhmm(start),
    endTime: hhmm(end),
  });

  await deps.collab!.withDoc(rundown.id, orgId, (doc) => {
    const cab = insertLine(doc, {
      cells: { tipo: 'CAB_RAF', nombre: 'CABECERA', clip: 'CABECERA', dur_vtr: 8, fuente: 'VTR' },
    });
    const pres = insertLine(doc, {
      cells: {
        tipo: 'ACTING',
        nombre: 'PRESENTACIÓN',
        presenta: 'ANA',
        t_est: 30,
        fuente: 'CAM 1',
      },
    });
    const vtr = insertLine(doc, {
      cells: {
        tipo: 'VTR',
        nombre: 'PRESUPUESTOS',
        clip: 'PIEZA_PRESUPUESTOS',
        dur_vtr: 20,
        fuente: 'VTR',
      },
    });
    const ent = insertLine(doc, {
      cells: { tipo: 'TEMA', nombre: 'ENTREVISTA', presenta: 'ANA', t_est: 60, fuente: 'CAM 2' },
    });
    const dep = insertLine(doc, {
      cells: {
        tipo: 'VTR',
        nombre: 'DEPORTES',
        clip: 'PIEZA_DEPORTES',
        dur_vtr: 15,
        fuente: 'VTR',
      },
    });
    const desp = insertLine(doc, {
      cells: { tipo: 'ACTING', nombre: 'DESPEDIDA', presenta: 'ANA', t_est: 20, fuente: 'CAM 1' },
    });
    void cab;
    writeScript(doc, pres, [
      {
        kind: 'paso',
        text: 'Buenas tardes y bienvenidos al informativo de prueba de RunFlow. Esto que leo es el teleprompter: avanza solo o con la rueda del ratón.',
      },
      rotulo('TOT', 'Ana Pérez', 'Presentadora'),
      {
        kind: 'paso',
        text: 'Empezamos con los presupuestos aprobados hoy por el Gobierno.',
      },
    ]);
    writeScript(doc, vtr, [
      { kind: 'off', text: 'El Consejo de Ministros ha aprobado hoy las cuentas del próximo año.' },
      rotulo('TOT', 'María López', 'Portavoz del Gobierno', '00:03', '00:08'),
      rotulo('LOC', 'Sevilla, Andalucía', '', '00:10', '00:15'),
    ]);
    writeScript(doc, ent, [
      { kind: 'paso', text: 'Nos acompaña en el plató Luis García. Buenas tardes, Luis.' },
      rotulo('TOT', 'Luis García', 'Director del centro'),
      rotulo('BAN', 'Entrevista en directo', 'Pregunta en redes con #RunFlowTV'),
    ]);
    writeScript(doc, dep, [rotulo('LOC', 'Estadio de La Cartuja', '', '00:02', '00:07')]);
    writeScript(doc, desp, [
      { kind: 'paso', text: 'Esto es todo por hoy. Gracias por su compañía y hasta mañana.' },
    ]);
  });

  // Directo en manual con los equipos armados: el GO mueve CasparCG y OBS.
  await call('PATCH', `/api/rundowns/${rundown.id}/live`, { mode: 'manual', armed: true });
  await call('POST', `/api/rundowns/${rundown.id}/outputs`, {
    kind: 'prompter',
    name: 'Teleprompter',
  });
  return true;
}
