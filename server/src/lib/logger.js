import pino from 'pino';

// Never let credentials reach the logs.
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.referer',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.connectionString',
];

/**
 * Request log line: no query string, no parsed query object, no referrer. Query strings can hold
 * secrets (invitation tokens in /accept-invite?token=…) and personal data (search text).
 * Only the path is logged.
 */
export function serializeRequest(req) {
  return {
    id: req.id,
    method: req.method,
    url: String(req.url ?? '').split('?')[0],
    headers: req.headers,
    remoteAddress: req.remoteAddress ?? req.socket?.remoteAddress,
  };
}

export function createLogger(config, destination) {
  return pino(
    {
      level: config.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { req: serializeRequest },
      ...(!destination &&
        config.env === 'development' && {
          transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
        }),
    },
    destination,
  );
}
