import { Router } from 'express';

/** Liveness only: this is not a database, payment or Telegram readiness check. */
export const healthRoutes = Router();
healthRoutes.get(['/health', '/healt'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', service: 'bitmax-api', version: '1.0.0' });
});
