import { Router } from 'express';

export function healthRoutes({ pool }) {
  const router = Router();

  // Liveness: the process is up. Never touches the database.
  router.get('/', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });

  // Readiness: the database is reachable. Used as Render's health check.
  router.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ data: { status: 'ok', database: 'ok' } });
    } catch (err) {
      req.log.warn({ err }, 'Readiness check failed');
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is not reachable', requestId: req.id },
      });
    }
  });

  return router;
}
