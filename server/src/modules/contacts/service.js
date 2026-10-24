import { conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { withTransaction } from '../../db/pool.js';
import * as repo from './repo.js';

export const toApi = (row) => ({
  id: row.id,
  name: row.name,
  types: [
    ...(row.is_customer ? ['customer'] : []),
    ...(row.is_supplier ? ['supplier'] : []),
    ...(row.is_partner ? ['partner'] : []),
  ],
  phone: row.phone,
  email: row.email,
  address: row.address,
  panNumber: row.pan_number,
  vatNumber: row.vat_number,
  notes: row.notes,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const audit = (tx, req, action, contact, extra = {}) =>
  writeAudit(tx, {
    req,
    businessId: req.business.id,
    actorUserId: req.auth.user.id,
    action,
    entityType: 'contact',
    entityId: contact.id,
    ...extra,
  });

/** All functions read the business and the user from the authenticated request, never from client input. */

export async function list({ pool, req }, query) {
  const { rows, total } = await repo.listContacts(pool, req.business.id, query);
  return { data: rows.map(toApi), meta: { page: query.page, pageSize: query.pageSize, total } };
}

export async function get({ pool, req }, id) {
  const row = await repo.findContact(pool, req.business.id, id);
  if (!row) throw notFound('Contact not found'); // also what a contact of another business looks like
  return toApi(row);
}

export function create({ pool, req }, data) {
  return withTransaction(pool, async (tx) => {
    const row = await repo.insertContact(tx, req.business.id, req.auth.user.id, data);
    const contact = toApi(row);
    await audit(tx, req, 'contact.create', contact, { after: contact });
    return contact;
  });
}

export function update({ pool, req }, id, data) {
  return withTransaction(pool, async (tx) => {
    const existing = await repo.findContact(tx, req.business.id, id, { forUpdate: true });
    if (!existing) throw notFound('Contact not found');
    const row = await repo.updateContact(tx, req.business.id, req.auth.user.id, id, data);

    const before = toApi(existing);
    const after = toApi(row);
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'updatedAt');
    await audit(tx, req, 'contact.update', after, {
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k]])),
    });
    return after;
  });
}

export function setArchived({ pool, req }, id, archived) {
  return withTransaction(pool, async (tx) => {
    const existing = await repo.findContact(tx, req.business.id, id, { forUpdate: true });
    if (!existing) throw notFound('Contact not found');
    if (Boolean(existing.archived_at) === archived) {
      throw conflict(archived ? 'This contact is already archived' : 'This contact is not archived');
    }
    const row = await repo.setArchived(tx, req.business.id, req.auth.user.id, id, archived);
    const contact = toApi(row);
    await audit(tx, req, archived ? 'contact.archive' : 'contact.unarchive', contact);
    return contact;
  });
}
