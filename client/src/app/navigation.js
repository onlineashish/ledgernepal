import { t } from '../i18n/en.js';

// Sidebar structure (requirements §12). `children` renders as an indented sub-list.
// Later phases add a `permission` key per item; the backend still enforces access.
export const NAV_ITEMS = [
  { key: 'dashboard', label: t('nav.dashboard'), to: '/', icon: 'dashboard', end: true },
  { key: 'contacts', label: t('nav.contacts'), to: '/contacts', icon: 'contacts' },
  { key: 'sales', label: t('nav.sales'), to: '/sales', icon: 'sales' },
  { key: 'purchases', label: t('nav.purchases'), to: '/purchases', icon: 'purchases' },
  { key: 'receipts-payments', label: t('nav.receiptsPayments'), to: '/receipts-payments', icon: 'money' },
  {
    key: 'ledger',
    label: t('nav.ledger'),
    to: '/ledger',
    icon: 'ledger',
    children: [
      { key: 'ledger-view', label: t('nav.viewLedger'), to: '/ledger', end: true },
      { key: 'ledger-add', label: t('nav.addLedgerEntry'), to: '/ledger/new' },
    ],
  },
  { key: 'reports', label: t('nav.reports'), to: '/reports', icon: 'reports' },
  { key: 'settings', label: t('nav.settings'), to: '/settings', icon: 'settings' },
];

// Dashboard quick actions (requirements §10).
export const QUICK_ACTIONS = [
  { key: 'contact', label: t('quick.addContact'), to: '/contacts/new' },
  { key: 'ledger', label: t('quick.addLedgerEntry'), to: '/ledger/new' },
  { key: 'sale', label: t('quick.createSale'), to: '/sales/new' },
  { key: 'purchase', label: t('quick.recordPurchase'), to: '/purchases/new' },
  { key: 'receipt', label: t('quick.recordReceipt'), to: '/receipts-payments/new-receipt' },
  { key: 'payment', label: t('quick.recordPayment'), to: '/receipts-payments/new-payment' },
];
