import type { Permission } from '@runflow/core';

/*
 * RunFlow se divide en tres áreas de trabajo, cada una con su menú:
 * Redacción, Dirección TV y Producción. La administración (configuración de
 * la empresa, usuarios y plataforma) está en la rueda dentada de la cabecera.
 */

export type AreaKey = 'redaccion' | 'direccion' | 'produccion';

export interface AreaItem {
  path: string;
  label: string;
  icon: string;
  /** Hace falta alguno de estos permisos (sin lista: todos lo ven). */
  anyOf?: Permission[];
}

export interface Area {
  key: AreaKey;
  label: string;
  icon: string;
  /** Quién puede entrar en el área (alguno de estos permisos). */
  anyOf: Permission[];
  items: AreaItem[];
}

const home: AreaItem = { path: '/inicio', label: 'Inicio', icon: '⌂' };
const rundowns: AreaItem = { path: '/escaletas', label: 'Escaletas', icon: '☰' };
const fridge: AreaItem = { path: '/nevera', label: 'Nevera', icon: '❄' };

export const AREAS: Area[] = [
  {
    key: 'redaccion',
    label: 'Redacción',
    icon: '✎',
    anyOf: ['script.edit_own', 'script.edit_any', 'templates.manage'],
    items: [
      home,
      rundowns,
      fridge,
      { path: '/fuentes', label: 'Fuentes', icon: '⇣' },
      { path: '/social', label: 'Redes sociales', icon: '#' },
      { path: '/archivo', label: 'Archivo + papelera', icon: '🗄' },
    ],
  },
  {
    key: 'direccion',
    label: 'Dirección TV',
    icon: '◉',
    anyOf: ['live.go', 'cg.fire', 'devices.configure'],
    items: [
      home,
      rundowns,
      {
        path: '/rotulacion',
        label: 'Rotulación',
        icon: 'Aa',
        anyOf: ['cg.fire', 'script.edit_any'],
      },
      {
        path: '/diseno',
        label: 'Diseño',
        icon: '◧',
        anyOf: ['devices.configure', 'org.configure'],
      },
      {
        path: '/station',
        label: 'RunFlow Station',
        icon: '▣',
        anyOf: ['station.admin', 'devices.configure', 'org.configure'],
      },
      { path: '/reproductor', label: 'Reproductor de vídeos', icon: '▶' },
      {
        path: '/camaras',
        label: 'Control de cámara',
        icon: '⌖',
        anyOf: ['devices.configure', 'org.configure', 'live.go'],
      },
    ],
  },
  {
    key: 'produccion',
    label: 'Producción',
    icon: '▦',
    anyOf: ['production.view'],
    items: [
      home,
      rundowns,
      fridge,
      { path: '/produccion', label: 'Producción', icon: '▦', anyOf: ['production.view'] },
    ],
  },
];

const has = (perms: readonly string[], list?: Permission[]) =>
  !list || list.some((p) => perms.includes(p));

/** Áreas a las que puede entrar quien tiene estos permisos. */
export const allowedAreas = (perms: readonly string[]): Area[] =>
  AREAS.filter((a) => has(perms, a.anyOf));

export const areaItems = (area: Area, perms: readonly string[]): AreaItem[] =>
  area.items.filter((i) => has(perms, i.anyOf));

/** Área a la que pertenece una ruta (para cambiar de área al abrir un enlace). */
export function areaForPath(path: string, allowed: Area[]): AreaKey | null {
  const owners = allowed.filter((a) =>
    a.items.some((i) => i.path !== '/inicio' && i.path !== '/escaletas' && path.startsWith(i.path)),
  );
  return owners.length === 1 ? owners[0]!.key : null;
}
