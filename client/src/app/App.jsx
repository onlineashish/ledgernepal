import { Route, Routes } from 'react-router';
import { AcceptInvitePage } from '../auth/AcceptInvitePage.jsx';
import { ChooseBusinessPage } from '../auth/ChooseBusinessPage.jsx';
import { ForgotPasswordPage } from '../auth/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from '../auth/ResetPasswordPage.jsx';
import { AccountPage } from '../features/account/AccountPage.jsx';
import { LoginPage } from '../auth/LoginPage.jsx';
import { RegisterPage } from '../auth/RegisterPage.jsx';
import { PublicOnly, RequireAuth, RequirePermission } from '../auth/guards.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { NotFoundPage, PlaceholderPage } from '../features/common/PlaceholderPage.jsx';
import { TeamPage } from '../features/team/TeamPage.jsx';
import { t } from '../i18n/en.js';
import { AppLayout } from './AppLayout.jsx';

const PHASE4 = 'Phase 4 (core business features)';

// [path, title, permission(s) required to open it]. One placeholder per route until the real feature replaces it.
const PLACEHOLDER_ROUTES = [
  ['contacts', t('nav.contacts'), 'contacts.view'],
  ['contacts/new', t('quick.addContact'), 'contacts.create'],
  ['sales', t('nav.sales'), 'sales.view'],
  ['sales/new', t('quick.createSale'), 'sales.create'],
  ['purchases', t('nav.purchases'), 'purchases.view'],
  ['purchases/new', t('quick.recordPurchase'), 'purchases.create'],
  ['receipts-payments', t('nav.receiptsPayments'), ['receipts.view', 'payments.view']],
  ['receipts-payments/new-receipt', t('quick.recordReceipt'), 'receipts.create'],
  ['receipts-payments/new-payment', t('quick.recordPayment'), 'payments.create'],
  ['ledger', t('nav.viewLedger'), 'ledger.view'],
  ['ledger/new', t('nav.addLedgerEntry'), 'ledger.create'],
  ['reports', t('nav.reports'), 'reports.view'],
  ['settings', t('nav.settings'), 'business.view'],
];

export function App() {
  return (
    <Routes>
      {/* Not logged in yet (a logged-in person is sent on to the app) */}
      <Route element={<PublicOnly />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
      </Route>

      {/* Work whether or not you are logged in: the page adapts */}
      <Route path="accept-invite" element={<AcceptInvitePage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />

      {/* Logged in, business not required yet */}
      <Route element={<RequireAuth requireBusiness={false} />}>
        <Route path="choose-business" element={<ChooseBusinessPage />} />
      </Route>

      {/* Logged in with an active business */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="team" element={<RequirePermission permission="users.view"><TeamPage /></RequirePermission>} />
          {PLACEHOLDER_ROUTES.map(([path, title, permission]) => (
            <Route
              key={path}
              path={path}
              element={
                <RequirePermission permission={permission}>
                  <PlaceholderPage title={title} phase={PHASE4} />
                </RequirePermission>
              }
            />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
