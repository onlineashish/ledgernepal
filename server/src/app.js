import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRoutes } from './modules/health/routes.js';

/**
 * Builds the Express app without starting a server, so tests can call it
 * directly with supertest.
 */
export function createApp({ config, logger, pool }) {
  const app = express();

  app.disable('x-powered-by');
  // Behind Render's proxy, trust exactly that many hops so req.ip / req.secure are correct.
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
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

  app.use('/api/health', healthRoutes({ pool }));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
