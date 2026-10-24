// Single source of truth for roles and permissions (plan.md §7).
// The server seeds the database from this file and enforces it on every request;
// the client only uses it to hide buttons (never as a security mechanism).

export const PERMISSIONS = Object.freeze({
  'business.view': 'View business profile',
  'business.update': 'Edit business profile and PAN/VAT details',
  'settings.manage': 'Manage tax, numbering and date settings',
  'users.view': 'View business members and invitations',
  'users.invite': 'Invite new members',
  'users.manage': 'Change member roles/permissions and deactivate members',
  'contacts.view': 'View contacts',
  'contacts.create': 'Create contacts',
  'contacts.update': 'Edit contacts',
  'contacts.archive': 'Archive and unarchive contacts',
  'ledger.view': 'View contact ledgers and direct entries',
  'ledger.create': 'Add direct ledger entries and opening balances',
  'ledger.correct': 'Void or correct posted ledger entries',
  'sales.view': 'View sales invoices',
  'sales.create': 'Create and post sales invoices',
  'sales.update': 'Edit draft sales invoices',
  'sales.void': 'Void posted sales invoices',
  'purchases.view': 'View purchase bills',
  'purchases.create': 'Create and post purchase bills',
  'purchases.update': 'Edit draft purchase bills',
  'purchases.void': 'Void posted purchase bills',
  'receipts.view': 'View receipts',
  'receipts.create': 'Record receipts and allocate them to invoices',
  'receipts.void': 'Void receipts',
  'payments.view': 'View payments',
  'payments.create': 'Record payments and allocate them to bills',
  'payments.void': 'Void payments',
  'reports.view': 'View dashboard and reports',
  'reports.export': 'Export and print reports',
  'audit.view': 'View the audit log',
});

export const PERMISSION_KEYS = Object.freeze(Object.keys(PERMISSIONS));

// Higher rank = more authority. Nobody can manage a member of equal or higher rank
// (the Owner is the exception, being the top). Ranks leave gaps for future custom roles.
export const ROLES = Object.freeze({
  owner: { name: 'Business Owner', rank: 100 },
  business_admin: { name: 'Business Administrator', rank: 80 },
  accountant: { name: 'Accountant', rank: 60 },
  staff: { name: 'Staff', rank: 40 },
  viewer: { name: 'Viewer', rank: 10 },
});

export const ROLE_KEYS = Object.freeze(Object.keys(ROLES));

const CONTACTS_ALL = ['contacts.view', 'contacts.create', 'contacts.update', 'contacts.archive'];

// Default permissions per role. The Owner always has everything; per-member
// overrides can add or remove individual permissions on top of these.
export const ROLE_PERMISSIONS = Object.freeze({
  owner: PERMISSION_KEYS,
  business_admin: [
    'business.view', 'business.update', 'settings.manage',
    'users.view', 'users.invite', 'users.manage',
    ...CONTACTS_ALL,
    'ledger.view', 'ledger.create',
    'sales.view', 'sales.create', 'sales.update',
    'purchases.view', 'purchases.create', 'purchases.update',
    'receipts.view', 'receipts.create',
    'payments.view', 'payments.create',
    'reports.view', 'reports.export',
    'audit.view',
  ],
  accountant: [
    'business.view',
    ...CONTACTS_ALL,
    'ledger.view', 'ledger.create', 'ledger.correct',
    'sales.view', 'sales.create', 'sales.update', 'sales.void',
    'purchases.view', 'purchases.create', 'purchases.update', 'purchases.void',
    'receipts.view', 'receipts.create', 'receipts.void',
    'payments.view', 'payments.create', 'payments.void',
    'reports.view', 'reports.export',
  ],
  staff: [
    'business.view',
    'contacts.view', 'contacts.create', 'contacts.update',
    'ledger.view', 'ledger.create',
    'sales.view', 'sales.create', 'sales.update',
    'purchases.view', 'purchases.create', 'purchases.update',
    'receipts.view', 'receipts.create',
  ],
  viewer: [
    'business.view', 'contacts.view', 'ledger.view', 'sales.view',
    'purchases.view', 'receipts.view', 'payments.view', 'reports.view',
  ],
});

// Permissions that may never be granted through overrides, even by someone who holds them.
// (Plan §7: only the Owner may hand out users.manage.)
export const OWNER_ONLY_GRANTS = Object.freeze(['users.manage']);
