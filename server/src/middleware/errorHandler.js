import { AppError, notFound } from '../lib/errors.js';

export function notFoundHandler(req, _res, next) {
  next(notFound(`No route for ${req.method} ${req.baseUrl}${req.path}`));
}

// Express recognises error handlers by their 4 arguments — keep `_next`.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let appError = err;

  if (!(err instanceof AppError)) {
    if (err.type === 'entity.parse.failed') {
      appError = new AppError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
    } else if (err.type === 'entity.too.large') {
      appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else {
      // Unexpected: log full details server-side, return nothing sensitive.
      req.log?.error({ err }, 'Unhandled error');
      appError = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
    }
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
      requestId: req.id,
    },
  });
}
