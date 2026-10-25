import { Button, EmptyState, PageHeader } from '../../components/ui.jsx';
import { t } from '../../i18n/en.js';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title={t('common.notFound')} />
      <EmptyState
        title={t('common.notFound')}
        description="The page you are looking for does not exist."
        action={<Button to="/">{t('common.backToDashboard')}</Button>}
      />
    </>
  );
}
