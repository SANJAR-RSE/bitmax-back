import { Request, Response, NextFunction } from 'express';
import { config, safeEquals } from '../config';

/**
 * Guards internal-only endpoints (escrow & transaction management, PII listings).
 * These routes are not meant to be reachable from the public internet directly —
 * only the bot process / trusted internal tools should call them, using the
 * `x-internal-key` header. The public catalog (products) endpoints stay open.
 */
export function requireInternalKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-internal-key') || '';

  if (!config.internalApiKey || !provided || !safeEquals(provided, config.internalApiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}
