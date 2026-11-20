import { z } from 'zod';
import { emailSchema, orgNameSchema, passwordSchema, personNameSchema } from './schemas';

/*
 * Planes (PLAN §29). Los límites solo se aplican en la nube SaaS
 * (PLAN_LIMITS=true); una instalación propia o una Station no tienen límites
 * de plan (la Station local va con su licencia).
 */

export const PLAN_KEYS = ['free', 'basic', 'pro', 'edu', 'local'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface PlanDef {
  key: PlanKey;
  name: string;
  for: string;
  /** null = sin límite. */
  maxUsers: number | null;
  maxPrograms: number | null;
  /** CasparCG y mezcladores. */
  devices: boolean;
  station: boolean;
  ai: boolean;
  /** Se contrata en la web (Stripe). */
  selfService: boolean;
  features: string[];
}

export const PLANS: PlanDef[] = [
  {
    key: 'free',
    name: 'Gratis',
    for: 'Probar RunFlow',
    maxUsers: 3,
    maxPrograms: 1,
    devices: false,
    station: false,
    ai: false,
    selfService: true,
    features: ['1 programa', '3 usuarios', 'Escaleta, guion, prompter y salidas', 'Sin publicidad'],
  },
  {
    key: 'basic',
    name: 'Básico',
    for: 'Producciones pequeñas',
    maxUsers: 10,
    maxPrograms: 5,
    devices: false,
    station: false,
    ai: false,
    selfService: true,
    features: [
      '5 programas',
      '10 usuarios',
      'Todo lo del plan Gratis',
      'Plantillas, nevera y archivo',
    ],
  },
  {
    key: 'pro',
    name: 'Profesional',
    for: 'Televisiones locales',
    maxUsers: 50,
    maxPrograms: null,
    devices: true,
    station: true,
    ai: true,
    selfService: true,
    features: [
      'Programas ilimitados',
      '50 usuarios',
      'RunFlow Station',
      'CasparCG y mezcladores',
      'Inteligencia artificial',
    ],
  },
  {
    key: 'edu',
    name: 'Educación',
    for: 'Escuelas y universidades',
    maxUsers: 500,
    maxPrograms: null,
    devices: true,
    station: true,
    ai: true,
    selfService: false,
    features: [
      'Muchas cuentas para el alumnado',
      'Todo lo del plan Profesional',
      'Precio reducido',
    ],
  },
  {
    key: 'local',
    name: 'Local',
    for: 'Sin nube',
    maxUsers: null,
    maxPrograms: null,
    devices: true,
    station: true,
    ai: true,
    selfService: false,
    features: ['RunFlow Station con licencia anual por estudio', 'Todo dentro de vuestra red'],
  },
];

export const PLAN_BY_KEY: Record<string, PlanDef> = Object.fromEntries(
  PLANS.map((p) => [p.key, p]),
);

export function planOf(key: string | null | undefined): PlanDef {
  return PLAN_BY_KEY[key ?? ''] ?? PLAN_BY_KEY.free!;
}

export interface PlanPrice {
  amount: number;
  currency: string;
  interval: string | null;
}

export interface BillingDto {
  plan: PlanKey;
  /** Estado de la suscripción en Stripe (active, past_due, canceled…). */
  status: string | null;
  renewsAt: string | null;
  /** Hay cobro con Stripe en esta instalación. */
  billingEnabled: boolean;
  limitsEnforced: boolean;
  hasCustomer: boolean;
  usage: { users: number; programs: number };
  plans: (PlanDef & { price: PlanPrice | null; purchasable: boolean })[];
}

export const checkoutInput = z.object({ plan: z.enum(['basic', 'pro']) });

export const signupInput = z.object({
  orgName: orgNameSchema,
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'Hay que aceptar las condiciones' }),
});
export type SignupInput = z.infer<typeof signupInput>;
