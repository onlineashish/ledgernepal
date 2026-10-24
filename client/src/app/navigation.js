import { t } from '../i18n/en.js';

// Sidebar structure (requirements §12). `children` renders as an indented sub-list.
// `permission` (a key or a list meaning "any of") only decides what to SHOW; the server enforces access.
export const NAV_ITEMS = [
  { key: 'dashboard', label: t('nav.dashboard'), to: '/', icon: 'dashboard', end: true },
  { key: 'contacts', label: t('nav.contacts'), to: '/contacts', icon: 'contacts', permission: 'contacts.view' },
  { key: 'sales', label: t('nav.sales'), to: '/sales', icon: 'sales', permission: 'sales.view' },
  { key: 'purchases', label: t('nav.purchases'), to: '/purchases', icon: 'purchases', permission: 'purchases.view' },
  { key: 'receipts-payments', label: t('nav.receiptsPayments'), to: '/receipts-payments', icon: 'money', permission: ['receipts.view', 'payments.view'] },
  {
    key: 'ledger',
    label: t('nav.ledger'),
    to: '/ledger',
    icon: 'ledger',
    permission: 'ledger.view',
    children: [
      { key: 'ledger-view', label: t('nav.viewLedger'), to: '/ledger', end: true },
      { key: 'ledger-add', label: t('nav.addLedgerEntry'), to: '/ledger/new', permission: 'ledger.create' },
    ],
  },
  { key: 'reports', label: t('nav.reports'), to: '/reports', icon: 'reports', permission: 'reports.view' },
  { key: 'team', label: t('nav.team'), to: '/team', icon: 'team', permission: 'users.view' },
  { key: 'settings', label: t('nav.settings'), to: '/settings', icon: 'settings', permission: 'business.view' },
];

// Dashboard quick actions (requirements §10).
export const QUICK_ACTIONS = [
  { key: 'contact', label: t('quick.addContact'), to: '/contacts/new', permission: 'contacts.create' },
  { key: 'ledger', label: t('quick.addLedgerEntry'), to: '/ledger/new', permission: 'ledger.create' },
  { key: 'sale', label: t('quick.createSale'), to: '/sales/new', permission: 'sales.create' },
  { key: 'purchase', label: t('quick.recordPurchase'), to: '/purchases/new', permission: 'purchases.create' },
  { key: 'receipt', label: t('quick.recordReceipt'), to: '/receipts-payments/new-receipt', permission: 'receipts.create' },
  { key: 'payment', label: t('quick.recordPayment'), to: '/receipts-payments/new-payment', permission: 'payments.create' },
];

/** Keeps the items the signed-in person may use. `auth` is the object from useAuth(). */
export function visibleTo(auth, items) {
  return items.filter((item) => {
    if (!item.permission) return true;
    return Array.isArray(item.permission) ? auth.canAny(item.permission) : auth.can(item.permission);
  });
}
