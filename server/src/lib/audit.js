/**
 * Appends one row to audit_logs (append-only; the database blocks UPDATE/DELETE).
 * Pass the same `db` client as the change itself when inside a transaction so the
 * audit entry commits or rolls back together with the change it describes.
 *
 * Never put passwords, tokens or full request bodies into before/after/metadata.
 */
export async function writeAudit(
  db,
  { req, businessId = null, actorUserId = null, action, entityType = null, entityId = null, before = null, after = null, metadata = null },
) {
  await db.query(
    `INSERT INTO audit_logs
       (business_id, actor_user_id, actor_ip, request_id, action, entity_type, entity_id, before, after, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      businessId,
      actorUserId,
      req?.ip ?? null,
      req?.id ?? null,
      action,
      entityType,
      entityId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      metadata === null ? null : JSON.stringify(metadata),
    ],
  );
}
