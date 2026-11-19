import { ALL_PERMISSIONS, type Permission } from './permissions';

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

/** Rol con todos los permisos. No se puede borrar y siempre debe quedar al menos un miembro activo con él. */
export const ADMIN_ROLE_KEY = 'admin';

const VIEW: Permission[] = ['rundown.view'];

/** Roles que se crean al dar de alta una empresa (PLAN §3). Editables por cada empresa. */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: ADMIN_ROLE_KEY,
    name: 'Administrador',
    description: 'Usuarios, licencias y configuración global',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'productor',
    name: 'Productor / Editor jefe',
    description: 'Crea escaletas, ordena, aprueba y controla tiempos',
    permissions: [
      ...VIEW,
      'rundown.edit_structure',
      'rundown.edit_cells',
      'script.edit_own',
      'script.edit_any',
      'script.approve',
      'templates.manage',
      'program.configure',
      'media.manage',
    ],
  },
  {
    key: 'redactor',
    name: 'Redactor / Periodista',
    description: 'Escribe el guion de sus piezas',
    permissions: [...VIEW, 'rundown.edit_cells', 'script.edit_own', 'media.manage'],
  },
  {
    key: 'realizador',
    name: 'Realizador',
    description: 'Ejecuta el directo',
    permissions: [...VIEW, 'rundown.edit_cells', 'live.go', 'cg.fire', 'prompter.control'],
  },
  {
    key: 'operador_cg',
    name: 'Operador CG',
    description: 'Lanza y revisa rótulos',
    permissions: [...VIEW, 'cg.fire'],
  },
  {
    key: 'presentador',
    name: 'Presentador / Prompter',
    description: 'Teleprompter y vista de presentador',
    permissions: [...VIEW, 'prompter.control'],
  },
  {
    key: 'tecnico',
    name: 'Técnico',
    description: 'VTR, sonido, cámaras: sus columnas y estados',
    permissions: [...VIEW, 'rundown.edit_cells'],
  },
  {
    key: 'produccion',
    name: 'Producción',
    description: 'Invitados, teléfonos, sets y logística',
    permissions: [...VIEW, 'rundown.edit_cells', 'budget.view'],
  },
  {
    key: 'profesor',
    name: 'Profesor',
    description: 'Educación: gestiona clases y escaletas de alumnos',
    permissions: [
      ...VIEW,
      'rundown.edit_structure',
      'rundown.edit_cells',
      'script.edit_own',
      'script.edit_any',
      'script.approve',
      'templates.manage',
      'live.go',
      'cg.fire',
      'prompter.control',
      'media.manage',
    ],
  },
  {
    key: 'alumno',
    name: 'Alumno',
    description: 'Educación: participa en las escaletas de su clase',
    permissions: [...VIEW, 'rundown.edit_cells', 'script.edit_own'],
  },
  {
    key: 'lectura',
    name: 'Solo lectura',
    description: 'Ver escaletas',
    permissions: [...VIEW],
  },
];
