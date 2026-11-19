/**
 * Permisos por capacidad (PLAN §26). Los roles son conjuntos de estos permisos.
 * Las claves son estables: se guardan en base de datos.
 */
export const PERMISSIONS = {
  'rundown.view': 'Ver escaletas',
  'rundown.edit_structure': 'Editar estructura de escaleta (añadir, mover, borrar líneas)',
  'rundown.edit_cells': 'Editar celdas de escaleta',
  'script.edit_own': 'Editar guiones propios',
  'script.edit_any': 'Editar cualquier guion',
  'script.approve': 'Aprobar guiones / marcar FINAL',
  'live.go': 'Ejecutar GO (directo)',
  'cg.fire': 'Lanzar rótulos',
  'prompter.control': 'Controlar teleprompter',
  'media.manage': 'Gestionar media',
  'templates.manage': 'Gestionar plantillas y nevera',
  'program.configure': 'Configurar programas',
  'org.configure': 'Configurar la empresa',
  'users.manage': 'Gestionar usuarios',
  'budget.view': 'Ver presupuestos',
  'station.admin': 'Administrar Station',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function hasPermission(
  granted: readonly string[] | undefined | null,
  required: Permission,
): boolean {
  return !!granted && granted.includes(required);
}
