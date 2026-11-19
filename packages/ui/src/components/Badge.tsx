import type { ReactNode } from 'react';

export function Badge({
  tone = 'default',
  children,
  title,
}: {
  tone?: 'default' | 'accent' | 'success' | 'muted';
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className={['rf-badge', tone !== 'default' && `rf-badge--${tone}`].filter(Boolean).join(' ')}
      title={title}
    >
      {children}
    </span>
  );
}
