import { AppError, forbidden } from '../lib/errors.js';

/** For owner-exclusive actions (transfer ownership). These are not grantable permissions. */
export function requireOwner(req, _res, next) {
  if (!req.business) return next(new AppError(409, 'NO_ACTIVE_BUSINESS', 'Choose a business to continue'));
  if (!req.business.isOwner) return next(forbidden('Only the business owner can do this'));
  return next();
}
requireOwner.guard = 'owner';
