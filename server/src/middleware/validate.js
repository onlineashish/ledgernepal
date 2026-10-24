import { validationFailed } from '../lib/errors.js';

/**
 * Validates req.body / req.query / req.params with zod schemas. On success the parsed
 * (trimmed, normalised, typed) values are in req.valid.body / .query / .params — handlers
 * must read from there and never from the raw request. Use z.strictObject so unexpected
 * fields (e.g. a smuggled business_id or is_platform_admin) are rejected, not ignored.
 */
export function validate({ body, query, params }) {
  const parts = { body, query, params };
  return (req, _res, next) => {
    const valid = {};
    const details = [];
    for (const [part, schema] of Object.entries(parts)) {
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        valid[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const path = issue.path.join('.');
          details.push({ field: part === 'body' ? path : [part, path].filter(Boolean).join('.'), message: issue.message });
        }
      }
    }
    if (details.length) return next(validationFailed(details));
    req.valid = valid;
    return next();
  };
}
