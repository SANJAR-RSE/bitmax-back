import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { verifyWebhook } from '../services/tezcheckClient';
import { TezcheckEvent } from '../models/TezcheckEvent';

const eventSchema = z.object({
  id: z.string().min(1).max(191), type: z.string().regex(/^payment\.[a-z_]+$/), schema_version: z.literal(1),
  data: z.object({ external_reference: z.string().nullable(), bill_id: z.string().nullable(), environment: z.string() }).passthrough(),
}).passthrough();
export const tezcheckWebhook = Router();
tezcheckWebhook.post('/api/tezcheck/webhook', rateLimit({ windowMs: 60_000, limit: 300 }),
  express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Raw JSON required' });
    if (!verifyWebhook(req.body, req.get('X-Checkout-Timestamp') || '', req.get('X-Checkout-Delivery') || '',
      req.get('X-Checkout-Signature') || '', config.tezcheck.webhookSecret)) return res.status(401).json({ error: 'Invalid signature' });
    let event;
    try { event = eventSchema.parse(JSON.parse(req.body.toString('utf8'))); }
    catch { return res.status(400).json({ error: 'Invalid event' }); }
    try {
      await TezcheckEvent.updateOne({ eventId: event.id }, { $setOnInsert: { eventId: event.id, payload: event } }, { upsert: true });
      return res.json({ received: true });
    } catch (err: any) {
      if (err?.code === 11000) return res.json({ received: true });
      return res.status(503).json({ error: 'Retry delivery' });
    }
  });
