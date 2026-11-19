import type { ReactNode } from 'react';

export function PageHeader({
  number,
  title,
  intro,
  actions,
}: {
  number?: string;
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rf-page-header">
      <div>
        <h1 className="rf-page-header__title">
          {number && <span className="rf-page-header__number">{number}</span>}
          {title}
        </h1>
        {intro && <p className="rf-page-header__intro">{intro}</p>}
      </div>
      {actions && <div className="rf-page-header__actions">{actions}</div>}
    </div>
  );
}
