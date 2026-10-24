/**
 * Errors thrown deliberately by our code. The error handler turns these into
 * the standard response: { error: { code, message, details?, requestId } }.
 * Anything that is NOT an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const validationFailed = (details, message = 'Some fields are invalid') =>
  new AppError(400, 'VALIDATION_FAILED', message, details);
export const unauthenticated = (message = 'You need to log in') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'FORBIDDEN', message);
// Also used for records that belong to another business, so their existence is not revealed.
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict', details) => new AppError(409, 'CONFLICT', message, details);
