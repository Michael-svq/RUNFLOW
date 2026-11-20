import { and, count, eq } from 'drizzle-orm';
import { planOf, type PlanDef } from '@runflow/core';
import { memberships, organizations, programs, withTenant, type Db } from '@runflow/db';
import { HttpError } from '../errors';

/*
 * Límites de plan (PLAN §29). Solo con PLAN_LIMITS=true (nube SaaS): en una
 * instalación propia o en una Station no hay límites de plan.
 */

export type PlanCheck = 'users' | 'programs' | 'devices' | 'station' | 'ai';

function limitError(plan: PlanDef, what: string): HttpError {
  return new HttpError(
    402,
    'plan_limit',
    `Tu plan ${plan.name} ${what}. Mejóralo en 10 Configuración → Plan y facturación.`,
  );
}

export async function orgPlan(db: Db, ctx: { orgId: string; userId: string }): Promise<PlanDef> {
  const [row] = await withTenant(db, ctx, (tx) =>
    tx
      .select({ plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId)),
  );
  return planOf(row?.plan);
}

export async function planUsage(db: Db, ctx: { orgId: string; userId: string }) {
  return withTenant(db, ctx, async (tx) => {
    const [users] = await tx
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.active, true)));
    const [progs] = await tx
      .select({ n: count() })
      .from(programs)
      .where(and(eq(programs.orgId, ctx.orgId), eq(programs.archived, false)));
    return { users: users?.n ?? 0, programs: progs?.n ?? 0 };
  });
}

/** Lanza 402 si el plan de la empresa no permite la acción. */
export async function assertPlan(
  db: Db,
  enforced: boolean,
  ctx: { orgId: string; userId: string },
  check: PlanCheck,
): Promise<void> {
  if (!enforced) return;
  const plan = await orgPlan(db, ctx);
  if (check === 'devices' && !plan.devices)
    throw limitError(plan, 'no incluye equipos (CasparCG, mezcladores)');
  if (check === 'station' && !plan.station) throw limitError(plan, 'no incluye RunFlow Station');
  if (check === 'ai' && !plan.ai) throw limitError(plan, 'no incluye inteligencia artificial');
  if (check === 'users' || check === 'programs') {
    const usage = await planUsage(db, ctx);
    if (check === 'users' && plan.maxUsers !== null && usage.users >= plan.maxUsers)
      throw limitError(plan, `permite hasta ${plan.maxUsers} usuarios`);
    if (check === 'programs' && plan.maxPrograms !== null && usage.programs >= plan.maxPrograms)
      throw limitError(
        plan,
        `permite hasta ${plan.maxPrograms} programa${plan.maxPrograms === 1 ? '' : 's'}`,
      );
  }
}
