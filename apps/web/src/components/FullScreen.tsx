import { Alert, Button, Spinner } from '@runflow/ui';
import { t } from '../i18n';

export function FullScreenLoader() {
  return (
    <div className="rf-fullscreen">
      <Spinner size={28} label={t('common.loading')} />
    </div>
  );
}

export function FullScreenError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rf-fullscreen">
      <div className="rf-fullscreen__box">
        <Alert tone="error">{message}</Alert>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
