import { Route, Routes } from 'react-router';
import { AcceptInvitePage } from '../auth/AcceptInvitePage.jsx';
import { ChooseBusinessPage } from '../auth/ChooseBusinessPage.jsx';
import { ForgotPasswordPage } from '../auth/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from '../auth/ResetPasswordPage.jsx';
import { ContactDetailPage } from '../features/contacts/ContactDetailPage.jsx';
import { ContactFormPage } from '../features/contacts/ContactFormPage.jsx';
import { ContactsPage } from '../features/contacts/ContactsPage.jsx';
import { LedgerEntryFormPage } from '../features/ledger/LedgerEntryFormPage.jsx';
import { LedgerPage } from '../features/ledger/LedgerPage.jsx';
import { AccountPage } from '../features/account/AccountPage.jsx';
import { LoginPage } from '../auth/LoginPage.jsx';
import { RegisterPage } from '../auth/RegisterPage.jsx';
import { PublicOnly, RequireAuth, RequirePermission } from '../auth/guards.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { NotFoundPage } from '../features/common/PlaceholderPage.jsx';
import { ReportsPage } from '../features/reports/ReportsPage.jsx';
import { DocumentDetailPage } from '../features/documents/DocumentDetailPage.jsx';
import { DocumentFormPage } from '../features/documents/DocumentFormPage.jsx';
import { DocumentsPage } from '../features/documents/DocumentsPage.jsx';
import { SettlementDetailPage } from '../features/settlements/SettlementDetailPage.jsx';
import { SettlementFormPage } from '../features/settlements/SettlementFormPage.jsx';
import { SettlementsPage } from '../features/settlements/SettlementsPage.jsx';
import { SettingsPage } from '../features/settings/SettingsPage.jsx';
import { TeamPage } from '../features/team/TeamPage.jsx';
import { AppLayout } from './AppLayout.jsx';

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
          <Route path="sales" element={<RequirePermission permission="sales.view"><DocumentsPage kind="sale" /></RequirePermission>} />
          <Route path="sales/new" element={<RequirePermission permission="sales.create"><DocumentFormPage kind="sale" mode="create" /></RequirePermission>} />
          <Route path="sales/:id" element={<RequirePermission permission="sales.view"><DocumentDetailPage kind="sale" /></RequirePermission>} />
          <Route path="sales/:id/edit" element={<RequirePermission permission="sales.update"><DocumentFormPage kind="sale" mode="edit" /></RequirePermission>} />
          <Route path="purchases" element={<RequirePermission permission="purchases.view"><DocumentsPage kind="purchase" /></RequirePermission>} />
          <Route path="purchases/new" element={<RequirePermission permission="purchases.create"><DocumentFormPage kind="purchase" mode="create" /></RequirePermission>} />
          <Route path="purchases/:id" element={<RequirePermission permission="purchases.view"><DocumentDetailPage kind="purchase" /></RequirePermission>} />
          <Route path="purchases/:id/edit" element={<RequirePermission permission="purchases.update"><DocumentFormPage kind="purchase" mode="edit" /></RequirePermission>} />
          <Route path="receipts-payments" element={<RequirePermission permission={['receipts.view', 'payments.view']}><SettlementsPage /></RequirePermission>} />
          <Route path="receipts-payments/new-receipt" element={<RequirePermission permission="receipts.create"><SettlementFormPage kind="receipt" /></RequirePermission>} />
          <Route path="receipts-payments/new-payment" element={<RequirePermission permission="payments.create"><SettlementFormPage kind="payment" /></RequirePermission>} />
          <Route path="receipts-payments/receipts/:id" element={<RequirePermission permission="receipts.view"><SettlementDetailPage kind="receipt" /></RequirePermission>} />
          <Route path="receipts-payments/payments/:id" element={<RequirePermission permission="payments.view"><SettlementDetailPage kind="payment" /></RequirePermission>} />
          <Route path="settings" element={<RequirePermission permission="business.view"><SettingsPage /></RequirePermission>} />
          <Route path="contacts" element={<RequirePermission permission="contacts.view"><ContactsPage /></RequirePermission>} />
          <Route path="contacts/new" element={<RequirePermission permission="contacts.create"><ContactFormPage mode="create" /></RequirePermission>} />
          <Route path="contacts/:id" element={<RequirePermission permission="contacts.view"><ContactDetailPage /></RequirePermission>} />
          <Route path="contacts/:id/edit" element={<RequirePermission permission="contacts.update"><ContactFormPage mode="edit" /></RequirePermission>} />
          <Route path="ledger" element={<RequirePermission permission="ledger.view"><LedgerPage /></RequirePermission>} />
          <Route path="ledger/new" element={<RequirePermission permission="ledger.create"><LedgerEntryFormPage /></RequirePermission>} />
          <Route path="team" element={<RequirePermission permission="users.view"><TeamPage /></RequirePermission>} />
          <Route path="reports" element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
