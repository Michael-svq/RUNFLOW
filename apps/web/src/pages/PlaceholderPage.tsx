import { Badge } from '@runflow/ui';
import { PageHeader } from '../components/PageHeader';
import { t } from '../i18n';
import type { NavItem } from '../layouts/nav';

/** Secciones del menú que llegan en hitos posteriores. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader number={item.number} title={t(item.label)} />
      <div className="rf-card rf-empty">
        <Badge tone="accent">{item.milestone}</Badge>
        <p>{t('placeholder.body', { milestone: item.milestone ?? '' })}</p>
      </div>
    </>
  );
}
