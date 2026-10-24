import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { QUICK_ACTIONS, visibleTo } from '../../app/navigation.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Button, Card, PageHeader } from '../../components/ui.jsx';
import { t } from '../../i18n/en.js';

function ApiStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: ({ signal }) => apiFetch('/health/ready', { signal }),
    retry: false,
  });

  if (isPending) return <p className="text-sm text-slate-600">Checking server…</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm font-medium text-red-700">
        Server problem: {error.message}
      </p>
    );
  }
  return (
    <p className="text-sm font-medium text-emerald-700">
      Server and database are connected ({data.data.database}).
    </p>
  );
}

export function DashboardPage() {
  const auth = useAuth();
  const actions = visibleTo(auth, QUICK_ACTIONS);
  return (
    <>
      <PageHeader
        title={t('nav.dashboard')}
        description="Sales, purchases and outstanding balances will appear here once you can record transactions."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Quick actions">
          {actions.length === 0 && <p className="text-sm text-slate-600">Nothing to record with your current access.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {actions.map((action) => (
              <Button key={action.key} to={action.to} variant={action.key === 'ledger' ? 'primary' : 'secondary'}>
                {action.label}
              </Button>
            ))}
          </div>
        </Card>
        <Card title="System status">
          <ApiStatus />
        </Card>
      </div>
    </>
  );
}
