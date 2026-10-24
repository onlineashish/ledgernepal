import { Button, EmptyState, PageHeader } from '../../components/ui.jsx';
import { t } from '../../i18n/en.js';

/**
 * Honest stand-in for pages whose backend does not exist yet. It claims nothing
 * and saves nothing; each is replaced when its feature is built (see plan.md §12).
 */
export function PlaceholderPage({ title, phase }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title={t('common.comingSoon')}
        description={`${title} will be built in ${phase}. Nothing on this page is connected yet.`}
        action={
          <Button to="/" variant="secondary">
            {t('common.backToDashboard')}
          </Button>
        }
      />
    </>
  );
}

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
