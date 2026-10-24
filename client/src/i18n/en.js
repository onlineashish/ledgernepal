// English strings. A Nepali catalog (ne.js) with the same keys can be added later
// and selected in t() below. Keep user-visible text here, not scattered in components.
export const en = {
  'app.name': 'LedgerNepal',
  'app.tagline': 'Digital bahi-khata',
  'nav.dashboard': 'Dashboard',
  'nav.contacts': 'Contacts',
  'nav.sales': 'Sales',
  'nav.purchases': 'Purchases',
  'nav.receiptsPayments': 'Receipts & Payments',
  'nav.ledger': 'Ledger',
  'nav.viewLedger': 'View Ledger',
  'nav.addLedgerEntry': 'Add Ledger Entry',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'nav.team': 'Team',
  'nav.openMenu': 'Open menu',
  'nav.closeMenu': 'Close menu',
  'nav.main': 'Main navigation',
  'quick.addContact': 'Add Contact',
  'quick.addLedgerEntry': 'Add Ledger Entry',
  'quick.createSale': 'Create Sales Invoice',
  'quick.recordPurchase': 'Record Purchase',
  'quick.recordReceipt': 'Record Receipt',
  'quick.recordPayment': 'Record Payment',
  'common.comingSoon': 'Coming soon',
  'common.notFound': 'Page not found',
  'common.backToDashboard': 'Back to dashboard',
};

const catalogs = { en };

export function t(key, locale = 'en') {
  return catalogs[locale]?.[key] ?? catalogs.en[key] ?? key;
}
