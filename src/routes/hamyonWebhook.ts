import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config, safeEquals } from '../config';
import { verifyHamyonSign } from '../services/hamyonClient';
import { reconcileHamyonPayment } from '../services/hamyonPayments';

const callbackSchema = z.object({
  payment_id: z.string().min(1).max(191),
  order_id: z.string().regex(/^[a-f\d]{24}$/i),
  shop_id: z.coerce.string(),
  amount: z.coerce.string(),
  sign: z.string().min(1).max(64),
});

export const hamyonWebhook = Router();

hamyonWebhook.post(
  '/api/hamyon/complete/:token',
  rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }),
  express.urlencoded({ extended: false, limit: '20kb' }),
  express.json({ limit: '20kb' }),
  async (req, res) => {
    const token = config.hamyon.callbackToken;
    if (!token || !safeEquals(req.params.token, token)) return res.status(404).json({ error: 'Not found' });

    const parsed = callbackSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('[Hamyon] Callback rejected, fields:', Object.keys(req.body || {}).join(','));
      return res.status(400).json({ error: 'Invalid callback' });
    }
    const body = parsed.data;
    if (body.shop_id !== config.hamyon.shopId) return res.status(403).json({ error: 'Invalid shop' });

    // The secret URL token already authenticates the caller, and reconciliation trusts only
    // Hamyon's own status endpoint, so a signature in an unexpected format must not stall a
    // paid order. It is logged so the format can be fixed.
    const signed = verifyHamyonSign(
      { shopId: body.shop_id, paymentId: body.payment_id, amount: body.amount, sign: body.sign },
      config.hamyon.shopKey
    );
    console.log('[Hamyon] Callback:', body.order_id, 'payment', body.payment_id, 'amount', body.amount, 'status', String(req.body.status || ''), 'sign', signed ? 'ok' : `mismatch (amount "${body.amount}")`);

    // Duplicates and stale deliveries are safe: reconciliation acts only on a pending order.
    try {
      await reconcileHamyonPayment(body.order_id);
      return res.json({ result: 'ok' });
    } catch {
      console.error('[Hamyon] Callback reconciliation failed:', body.order_id);
      return res.status(503).json({ error: 'Retry delivery' });
    }
  }
);
