import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  COLUMN_BY_KEY,
  type CreateProgramInput,
  type CreateRundownInput,
  type ProgramDto,
  type RundownDto,
  type SaveViewInput,
  type SavedViewDto,
  type UpdateProgramInput,
  type UpdateRundownInput,
} from '@runflow/core';
import { programs, rundowns, views, withTenant, type Db, type Tx } from '@runflow/db';
import { badRequest, conflict, forbidden, notFound, pgErrorCode } from '../errors';
import type { TenantInfo } from '../auth/guards';
import { audit } from './audit';

/* ---------- Programas ---------- */

function toProgramDto(p: typeof programs.$inferSelect): ProgramDto {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    defaultStartTime: p.defaultStartTime,
    defaultDurationMin: p.defaultDurationMin,
    archived: p.archived,
  };
}

async function duplicateName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      throw badRequest('validation', 'Revisa los datos del formulario', {
        name: 'Ya existe un programa con ese nombre',
      });
    }
    throw err;
  }
}

export async function listPrograms(db: Db, t: TenantInfo): Promise<ProgramDto[]> {
  return withTenant(db, t, async (tx) => {
    const rows = await tx
      .select()
      .from(programs)
      .where(eq(programs.orgId, t.orgId))
      .orderBy(asc(programs.archived), asc(programs.name));
    return rows.map(toProgramDto);
  });
}

export async function createProgram(
  db: Db,
  t: TenantInfo,
  input: CreateProgramInput,
): Promise<ProgramDto> {
  return duplicateName(() =>
    withTenant(db, t, async (tx) => {
      const [row] = await tx
        .insert(programs)
        .values({
          orgId: t.orgId,
          name: input.name,
          type: input.type,
          defaultStartTime: input.defaultStartTime ?? null,
          defaultDurationMin: input.defaultDurationMin ?? null,
        })
        .returning();
      await audit(tx, {
        orgId: t.orgId,
        userId: t.userId,
        action: 'program.create',
        targetType: 'program',
        targetId: row!.id,
      });
      return toProgramDto(row!);
    }),
  );
}

export async function updateProgram(
  db: Db,
  t: TenantInfo,
  id: string,
  input: UpdateProgramInput,
): Promise<ProgramDto> {
  return duplicateName(() =>
    withTenant(db, t, async (tx) => {
      const [row] = await tx
        .update(programs)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(programs.id, id), eq(programs.orgId, t.orgId)))
        .returning();
      if (!row) throw notFound('Programa no encontrado');
      return toProgramDto(row);
    }),
  );
}

/* ---------- Escaletas ---------- */

const rundownSelect = {
  id: rundowns.id,
  programId: rundowns.programId,
  programName: programs.name,
  title: rundowns.title,
  airDate: rundowns.airDate,
  startTime: rundowns.startTime,
  endTime: rundowns.endTime,
  status: rundowns.status,
  lineCount: rundowns.lineCount,
  estimatedSeconds: rundowns.estimatedSeconds,
  createdAt: rundowns.createdAt,
  updatedAt: rundowns.updatedAt,
};

type RundownRow = {
  [K in keyof typeof rundownSelect]: (typeof rundownSelect)[K]['_']['data'];
};

function toRundownDto(r: RundownRow): RundownDto {
  return {
    ...r,
    status: r.status as RundownDto['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function rundownQuery(tx: Tx) {
  return tx
    .select(rundownSelect)
    .from(rundowns)
    .innerJoin(programs, eq(programs.id, rundowns.programId));
}

/** Escaleta de la empresa activa que no esté borrada (o 404). */
export async function requireRundown(tx: Tx, orgId: string, id: string): Promise<RundownRow> {
  const [row] = await rundownQuery(tx)
    .where(and(eq(rundowns.id, id), eq(rundowns.orgId, orgId), isNull(rundowns.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Escaleta no encontrada');
  return row;
}

export async function listRundowns(
  db: Db,
  t: TenantInfo,
  filter: { from?: string; to?: string; programId?: string },
): Promise<RundownDto[]> {
  return withTenant(db, t, async (tx) => {
    const conditions = [eq(rundowns.orgId, t.orgId), isNull(rundowns.deletedAt)];
    if (filter.from) conditions.push(gte(rundowns.airDate, filter.from));
    if (filter.to) conditions.push(lte(rundowns.airDate, filter.to));
    if (filter.programId) conditions.push(eq(rundowns.programId, filter.programId));
    const rows = await rundownQuery(tx)
      .where(and(...conditions))
      .orderBy(desc(rundowns.airDate), asc(rundowns.startTime), asc(programs.name));
    return rows.map(toRundownDto);
  });
}

export async function getRundown(db: Db, t: TenantInfo, id: string): Promise<RundownDto> {
  return withTenant(db, t, async (tx) => toRundownDto(await requireRundown(tx, t.orgId, id)));
}

export async function createRundown(
  db: Db,
  t: TenantInfo,
  input: CreateRundownInput,
): Promise<RundownDto> {
  return withTenant(db, t, async (tx) => {
    const [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.id, input.programId), eq(programs.orgId, t.orgId)))
      .limit(1);
    if (!program || program.archived) {
      throw badRequest('validation', 'Revisa los datos del formulario', {
        programId: 'Programa no válido',
      });
    }
    const [row] = await tx
      .insert(rundowns)
      .values({
        orgId: t.orgId,
        programId: program.id,
        title: input.title || program.name,
        airDate: input.airDate,
        startTime: input.startTime,
        endTime: input.endTime,
        createdBy: t.userId,
      })
      .returning({ id: rundowns.id });
    await audit(tx, {
      orgId: t.orgId,
      userId: t.userId,
      action: 'rundown.create',
      targetType: 'rundown',
      targetId: row!.id,
    });
    return toRundownDto(await requireRundown(tx, t.orgId, row!.id));
  });
}

export async function updateRundown(
  db: Db,
  t: TenantInfo,
  id: string,
  input: UpdateRundownInput,
): Promise<RundownDto> {
  return withTenant(db, t, async (tx) => {
    await requireRundown(tx, t.orgId, id);
    await tx
      .update(rundowns)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(rundowns.id, id), eq(rundowns.orgId, t.orgId)));
    return toRundownDto(await requireRundown(tx, t.orgId, id));
  });
}

/** Borrado lógico: la escaleta desaparece de los listados (la papelera llega en M5). */
export async function deleteRundown(db: Db, t: TenantInfo, id: string): Promise<void> {
  await withTenant(db, t, async (tx) => {
    await requireRundown(tx, t.orgId, id);
    await tx
      .update(rundowns)
      .set({ deletedAt: new Date() })
      .where(and(eq(rundowns.id, id), eq(rundowns.orgId, t.orgId)));
    await audit(tx, {
      orgId: t.orgId,
      userId: t.userId,
      action: 'rundown.delete',
      targetType: 'rundown',
      targetId: id,
    });
  });
}

/* ---------- Vistas guardadas ---------- */

function canEditView(t: TenantInfo, ownerUserId: string | null): boolean {
  return (
    ownerUserId === t.userId ||
    (ownerUserId === null && t.permissions.includes('program.configure'))
  );
}

function toViewDto(t: TenantInfo, v: typeof views.$inferSelect): SavedViewDto {
  return {
    id: v.id,
    name: v.name,
    shared: v.ownerUserId === null,
    ownerUserId: v.ownerUserId,
    columns: v.columns,
    canEdit: canEditView(t, v.ownerUserId),
  };
}

function checkColumns(input: SaveViewInput): void {
  const unknown = input.columns.filter((c) => !COLUMN_BY_KEY[c.key]);
  if (unknown.length > 0) {
    throw badRequest('validation', 'Revisa los datos del formulario', {
      columns: `Columnas desconocidas: ${unknown.map((c) => c.key).join(', ')}`,
    });
  }
}

export async function listViews(db: Db, t: TenantInfo): Promise<SavedViewDto[]> {
  return withTenant(db, t, async (tx) => {
    const rows = await tx
      .select()
      .from(views)
      .where(
        and(
          eq(views.orgId, t.orgId),
          or(isNull(views.ownerUserId), eq(views.ownerUserId, t.userId)),
        ),
      )
      .orderBy(asc(views.name));
    return rows.map((v) => toViewDto(t, v));
  });
}

export async function createView(
  db: Db,
  t: TenantInfo,
  input: SaveViewInput,
): Promise<SavedViewDto> {
  checkColumns(input);
  if (input.shared && !t.permissions.includes('program.configure')) {
    throw forbidden('Solo quien configura programas puede crear vistas compartidas');
  }
  return withTenant(db, t, async (tx) => {
    const [row] = await tx
      .insert(views)
      .values({
        orgId: t.orgId,
        ownerUserId: input.shared ? null : t.userId,
        name: input.name,
        columns: input.columns,
      })
      .returning();
    return toViewDto(t, row!);
  });
}

async function requireEditableView(tx: Tx, t: TenantInfo, id: string) {
  const [row] = await tx
    .select()
    .from(views)
    .where(and(eq(views.id, id), eq(views.orgId, t.orgId)))
    .limit(1);
  if (!row) throw notFound('Vista no encontrada');
  if (!canEditView(t, row.ownerUserId)) throw forbidden();
  return row;
}

export async function updateView(
  db: Db,
  t: TenantInfo,
  id: string,
  input: SaveViewInput,
): Promise<SavedViewDto> {
  checkColumns(input);
  return withTenant(db, t, async (tx) => {
    const current = await requireEditableView(tx, t, id);
    if (input.shared !== (current.ownerUserId === null)) {
      throw conflict('view_scope', 'No se puede cambiar si una vista es personal o compartida');
    }
    const [row] = await tx
      .update(views)
      .set({ name: input.name, columns: input.columns, updatedAt: new Date() })
      .where(eq(views.id, id))
      .returning();
    return toViewDto(t, row!);
  });
}

export async function deleteView(db: Db, t: TenantInfo, id: string): Promise<void> {
  await withTenant(db, t, async (tx) => {
    await requireEditableView(tx, t, id);
    await tx.delete(views).where(eq(views.id, id));
  });
}
