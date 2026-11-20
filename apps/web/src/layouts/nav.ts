import type { MessageKey } from '../i18n';

export interface NavItem {
  /** Número del menú, como en la propuesta (01–08). */
  number: string;
  path: string;
  label: MessageKey;
  /** Hito en el que estará disponible; sin hito = ya disponible. */
  milestone?: string;
  permission?: 'users.manage';
}

/** Menú principal (PLAN §23, "Anexo menús" de la propuesta). */
export const NAV_ITEMS: NavItem[] = [
  { number: '01', path: '/fuentes', label: 'nav.sources', milestone: 'Fase II' },
  { number: '02', path: '/nevera', label: 'nav.fridge' },
  { number: '03', path: '/social', label: 'nav.social', milestone: 'Fase III' },
  { number: '04', path: '/escaletas', label: 'nav.rundowns' },
  { number: '05', path: '/media', label: 'nav.media', milestone: 'Fase II' },
  { number: '06', path: '/archivo', label: 'nav.archive' },
  { number: '07', path: '/usuarios', label: 'nav.users', permission: 'users.manage' },
  { number: '08', path: '/perfil', label: 'nav.profile' },
];
