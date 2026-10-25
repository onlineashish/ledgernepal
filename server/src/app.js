import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { createBackgroundTasks } from './lib/background.js';
import { serializeRequest } from './lib/logger.js';
import { createMailer } from './lib/mailer.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { originCheck, requireJson } from './middleware/security.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { createGuards } from './middleware/guards.js';
import { authRoutes } from './modules/auth/routes.js';
import { businessRoutes } from './modules/businesses/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { invitationRoutes } from './modules/invitations/routes.js';
import { ledgerRoutes } from './modules/ledger/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { settlementRoutes } from './modules/settlements/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { healthRoutes } from './modules/health/routes.js';

/**
 * Builds the Express app without starting a server, so tests can call it
 * directly with supertest.
 */
export function createApp({ config, logger, pool, clientDist, rateLimit = {}, mailer = createMailer(config.mail, { logger }) }) {
  const app = express();
  const background = createBackgroundTasks(logger);
  app.locals.background = background; // tests and shutdown wait on this
  app.locals.mailer = mailer;

  app.disable('x-powered-by');
  // Behind Render's proxy, trust exactly that many hops so req.ip / req.secure are correct.
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      serializers: { req: serializeRequest }, // the HTTP logger has its own serializers; without this the query string is logged
      genReqId: (req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );
  app.use(helmet());
  // Production serves the SPA from the same origin; this only matters for cross-origin dev setups.
  app.use(cors({ origin: [config.appOrigin], credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(originCheck(config));
  app.use(requireJson);

  // Every API router is mounted through mount() so tests can list all routes and prove each one is guarded.
  app.locals.mountedRouters = [];
  const mount = (path, router) => {
    app.locals.mountedRouters.push([path, router]);
    app.use(path, router);
  };

  const guards = createGuards({ config, pool });
  const rateLimiters = createRateLimiters({ ...config.rateLimit, ...rateLimit });

  mount('/api/health', healthRoutes({ pool }));
  app.use('/api', rateLimiters.api);
  mount('/api/auth', authRoutes({ config, pool, rateLimiters, guards, mailer, background }));
  mount('/api/contacts', contactRoutes({ pool, guards }));
  mount('/api/ledger', ledgerRoutes({ pool, guards }));
  mount('/api/sales', documentRoutes({ pool, guards, type: 'sale', perms: { view: 'sales.view', create: 'sales.create', update: 'sales.update', void: 'sales.void' } }));
  mount('/api/receipts', settlementRoutes({ pool, guards, kind: 'receipt', perms: { view: 'receipts.view', create: 'receipts.create', void: 'receipts.void' } }));
  mount('/api/payments', settlementRoutes({ pool, guards, kind: 'payment', perms: { view: 'payments.view', create: 'payments.create', void: 'payments.void' } }));
  mount('/api/purchases', documentRoutes({ pool, guards, type: 'purchase', perms: { view: 'purchases.view', create: 'purchases.create', update: 'purchases.update', void: 'purchases.void' } }));
  mount('/api/reports', reportRoutes({ pool, guards }));
  mount('/api/users', userRoutes({ config, pool, guards }));
  mount('/api/invitations', invitationRoutes({ config, pool, rateLimiters, guards }));
  mount('/api/businesses', businessRoutes({ config, pool, guards }));
  mount('/api/settings', settingsRoutes({ pool, guards }));

  app.use('/api', notFoundHandler);

  // Production: serve the built React app from the same origin as the API.
  // Unknown non-API GET paths get index.html so client-side routes survive a refresh.
  if (clientDist) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache'); // always pick up a new deploy's bundle names
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
