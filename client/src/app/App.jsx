import { Route, Routes } from 'react-router';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { NotFoundPage, PlaceholderPage } from '../features/common/PlaceholderPage.jsx';
import { t } from '../i18n/en.js';
import { AppLayout } from './AppLayout.jsx';

const PHASE4 = 'Phase 4 (core business features)';

// [path, title]. One placeholder per route until the real feature replaces it.
const PLACEHOLDER_ROUTES = [
  ['contacts', t('nav.contacts')],
  ['contacts/new', t('quick.addContact')],
  ['sales', t('nav.sales')],
  ['sales/new', t('quick.createSale')],
  ['purchases', t('nav.purchases')],
  ['purchases/new', t('quick.recordPurchase')],
  ['receipts-payments', t('nav.receiptsPayments')],
  ['receipts-payments/new-receipt', t('quick.recordReceipt')],
  ['receipts-payments/new-payment', t('quick.recordPayment')],
  ['ledger', t('nav.viewLedger')],
  ['ledger/new', t('nav.addLedgerEntry')],
  ['reports', t('nav.reports')],
  ['settings', t('nav.settings')],
];

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        {PLACEHOLDER_ROUTES.map(([path, title]) => (
          <Route key={path} path={path} element={<PlaceholderPage title={title} phase={PHASE4} />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
