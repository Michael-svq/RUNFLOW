import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLine, lineScript, readLines, setCell, writeScript } from '@runflow/sync';
import {
  Client,
  createTestContext,
  PASSWORD,
  resetDb,
  roleId,
  setupFirstOrg,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let admin: Client;
let orgId: string;
let programId: string;
let rundownId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
  const s = await setupFirstOrg(ctx.app);
  admin = s.admin;
  orgId = s.me.activeOrg.id;
  programId = (await admin.post('/api/programs', { name: 'Noticias', type: 'informativo' })).body
    .program.id;
  rundownId = await newRundown();
});

async function newRundown(extra: Record<string, unknown> = {}) {
  const res = await admin.post('/api/rundowns', {
    programId,
    airDate: '2026-11-20',
    startTime: '14:00',
    endTime: '15:00',
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.rundown.id as string;
}

async function userWithRole(role: string, email: string) {
  await admin.post('/api/users', {
    name: 'Persona',
    email,
    roleId: await roleId(admin, role),
    password: 'temporal-12345',
  });
  const c = new Client(ctx.app);
  await c.login(email, 'temporal-12345');
  await c.post('/api/me/password', { currentPassword: 'temporal-12345', newPassword: PASSWORD });
  return c;
}

describe('chat por escaleta', () => {
  it('se envían y se leen mensajes, con el nombre de quien escribe', async () => {
    expect(
      (await admin.post(`/api/rundowns/${rundownId}/chat`, { body: 'Falta el VTR de deportes' }))
        .status,
    ).toBe(201);
    await admin.post(`/api/rundowns/${rundownId}/chat`, { body: 'Ya está subido' });
    const res = await admin.get(`/api/rundowns/${rundownId}/chat`);
    expect(res.body.messages.map((m: any) => [m.userName, m.body])).toEqual([
      ['Ana Admin', 'Falta el VTR de deportes'],
      ['Ana Admin', 'Ya está subido'],
    ]);
    expect((await admin.post(`/api/rundowns/${rundownId}/chat`, { body: '  ' })).status).toBe(400);
  });
});

describe('papelera y archivo', () => {
  it('una escaleta borrada va a la papelera, se restaura y se puede eliminar para siempre', async () => {
    await admin.delete(`/api/rundowns/${rundownId}`);
    let trash = await admin.get('/api/trash');
    expect(trash.body.items.map((i: any) => i.id)).toEqual([rundownId]);
    expect((await admin.post(`/api/trash/${rundownId}/restore`)).status).toBe(200);
    expect((await admin.get(`/api/rundowns/${rundownId}`)).status).toBe(200);
    await admin.delete(`/api/rundowns/${rundownId}`);
    expect((await admin.delete(`/api/trash/${rundownId}`)).status).toBe(200);
    trash = await admin.get('/api/trash');
    expect(trash.body.items).toEqual([]);
    expect((await admin.post(`/api/trash/${rundownId}/restore`)).status).toBe(404);
  });

  it('busca líneas en todas las escaletas', async () => {
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      insertLine(doc, { cells: { nombre: 'Presupuestos del Gobierno' } });
      insertLine(doc, { cells: { nombre: 'Deportes' } });
    });
    const res = await admin.get('/api/search?q=presupuestos');
    expect(res.body.results.map((r: any) => r.name)).toEqual(['Presupuestos del Gobierno']);
    expect((await admin.get('/api/search?q=x')).status).toBe(400);
  });
});

describe('plantillas', () => {
  it('se guarda una escaleta como plantilla (sin estados) y se crean escaletas a partir de ella', async () => {
    const lineId = await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      const id = insertLine(doc, { cells: { nombre: 'Cabecera', tipo: 'CAB_RAF', estado: 'E' } });
      writeScript(doc, id, [{ kind: 'paso', text: 'Buenas tardes' }]);
      insertLine(doc, { cells: { nombre: 'Titulares' } });
      return id;
    });
    const saved = await admin.post(`/api/rundowns/${rundownId}/save-as-template`, {
      name: 'Informativo tipo',
    });
    expect(saved.status).toBe(201);
    expect(saved.body.template.lineCount).toBe(2);
    expect((await admin.get('/api/templates')).body.templates).toHaveLength(1);

    const fromTpl = await newRundown({ templateId: saved.body.template.id, airDate: '2026-11-21' });
    const content = await ctx.collab.withDoc(fromTpl, orgId, (doc) => ({
      names: readLines(doc).map((l) => l.cells.nombre),
      estado: readLines(doc)[0]!.cells.estado,
      paso: lineScript(doc, lineId).paso,
    }));
    expect(content).toEqual({
      names: ['Cabecera', 'Titulares'],
      estado: undefined,
      paso: ['Buenas tardes'],
    });
    // Editar la nueva no cambia la original
    await ctx.collab.withDoc(fromTpl, orgId, (doc) =>
      setCell(doc, readLines(doc)[0]!.id, 'nombre', 'Otra'),
    );
    const original = await ctx.collab.withDoc(
      rundownId,
      orgId,
      (doc) => readLines(doc)[0]!.cells.nombre,
    );
    expect(original).toBe('Cabecera');
  });

  it('solo quien gestiona plantillas puede crearlas', async () => {
    const redactor = await userWithRole('redactor', 'r@chaneltv.test');
    expect(
      (await redactor.post(`/api/rundowns/${rundownId}/save-as-template`, { name: 'X' })).status,
    ).toBe(403);
  });
});

describe('nevera', () => {
  it('guarda líneas con guion para usarlas después (sin estado ni número)', async () => {
    const res = await admin.post('/api/fridge', {
      name: 'Reportaje de la feria',
      cells: { nombre: 'FERIA', tipo: 'VTR', dur_vtr: 95, estado: 'A', num: '8' },
      script: [{ kind: 'off', text: 'La feria abre sus puertas…' }],
    });
    expect(res.status).toBe(201);
    const list = (await admin.get('/api/fridge')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0].cells).toEqual({ nombre: 'FERIA', tipo: 'VTR', dur_vtr: 95 });
    expect(list[0].script).toEqual([{ kind: 'off', text: 'La feria abre sus puertas…' }]);
    expect((await admin.delete(`/api/fridge/${list[0].id}`)).status).toBe(200);
  });
});

describe('historial de versiones', () => {
  it('guarda versiones y restaura una (guardando antes lo actual)', async () => {
    await ctx.collab.withDoc(rundownId, orgId, (doc) =>
      insertLine(doc, { cells: { nombre: 'Versión buena' } }),
    );
    expect(
      (await admin.post(`/api/rundowns/${rundownId}/versions`, { label: 'Antes del cambio' }))
        .status,
    ).toBe(201);
    await ctx.collab.withDoc(rundownId, orgId, (doc) => {
      setCell(doc, readLines(doc)[0]!.id, 'nombre', 'Cambio malo');
      insertLine(doc, { cells: { nombre: 'Sobra' } });
    });
    const versions = (await admin.get(`/api/rundowns/${rundownId}/versions`)).body.versions;
    const manual = versions.find((v: any) => v.label === 'Antes del cambio');
    expect(manual).toMatchObject({ kind: 'manual', lineCount: 1 });

    expect(
      (await admin.post(`/api/rundowns/${rundownId}/versions/${manual.id}/restore`)).status,
    ).toBe(200);
    const names = await ctx.collab.withDoc(rundownId, orgId, (doc) =>
      readLines(doc).map((l) => l.cells.nombre),
    );
    expect(names).toEqual(['Versión buena']);
    const after = (await admin.get(`/api/rundowns/${rundownId}/versions`)).body.versions;
    expect(after.some((v: any) => v.kind === 'restore' && v.lineCount === 2)).toBe(true);
  });
});

describe('roles editables', () => {
  it('se crean roles propios, se editan y no se borran si están en uso', async () => {
    const created = await admin.post('/api/roles', {
      name: 'Jefe de informativos',
      permissions: ['rundown.view', 'rundown.edit_structure', 'live.go'],
    });
    expect(created.status).toBe(201);
    const id = created.body.role.id;
    const upd = await admin.patch(`/api/roles/${id}`, {
      name: 'Jefe de informativos',
      permissions: ['rundown.view', 'live.go'],
    });
    expect(upd.body.role.permissions).toEqual(['rundown.view', 'live.go']);
    expect((await admin.post('/api/roles', { name: 'X', permissions: ['inventado'] })).status).toBe(
      400,
    );

    await admin.post('/api/users', {
      name: 'Jefe',
      email: 'j@chaneltv.test',
      roleId: id,
      password: 'temporal-12345',
    });
    const del = await admin.delete(`/api/roles/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('role_in_use');
  });

  it('el rol de administrador no se toca', async () => {
    const adminRole = await roleId(admin, 'admin');
    expect(
      (await admin.patch(`/api/roles/${adminRole}`, { name: 'X', permissions: [] })).status,
    ).toBe(409);
    expect((await admin.delete(`/api/roles/${adminRole}`)).status).toBe(409);
  });
});
