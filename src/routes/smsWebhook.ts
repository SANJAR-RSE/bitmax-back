import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { paymentService } from '../services/paymentService';
import { notificationService } from '../services/notificationService';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { EscrowHold } from '../models/EscrowHold';
import { config, safeEquals } from '../config';
import { formatUzs } from '../utils/helpers';

const router = Router();

// The webhook secret is effectively a password guarding real money movement — throttle
// hard so it can't be brute-forced, independent of the global API rate limit.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const smsWebhookSchema = z.object({
  secret: z.string(),
  text: z.string().min(1).max(2000),
  sender: z.string().max(200).optional(),
  received_at: z.union([z.string(), z.number()]).optional(),
});

router.post('/sms-webhook', webhookLimiter, async (req: Request, res: Response) => {
  const parsed = smsWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const { secret, text, sender, received_at: receivedAt } = parsed.data;

  if (!safeEquals(secret, config.webhookSecret)) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  if (config.smsAllowedSenders.length > 0 && (!sender || !config.smsAllowedSenders.includes(sender))) {
    console.warn('[SMS Webhook] Rejected message from unrecognized sender:', sender);
    return res.status(403).json({ error: 'Unrecognized sender' });
  }

  try {
    const result = await paymentService.confirmPaymentBySms(text, sender, receivedAt);

    if (result.matched) {
      const t = result.transaction;

      // Tell the buyer their money arrived and hand them the reveal button. Without this the
      // buyer had no way to know the payment landed — v1 only notified the admin.
      const [buyer, product, hold] = await Promise.all([
        User.findById(t.buyerId).select('telegramId'),
        Product.findById(t.productId).select('title'),
        EscrowHold.findOne({ transactionId: t._id }).select('_id autoReleaseAt'),
      ]);

      if (buyer?.telegramId && hold) {
        await notificationService.notifyPaymentConfirmed(
          buyer.telegramId,
          product?.title || 'Mahsulot',
          t.basePrice,
          String(hold._id),
          hold.autoReleaseAt
        );
      }

      await notificationService.notifyAdmin(
        `💳 <b>To‘lov tasdiqlandi</b>\n\n` +
          `Summa: ${formatUzs(result.amount || 0)}\n` +
          `Tranzaksiya: <code>${t._id}</code>\n` +
          `Mahsulot: <code>${t.productId}</code>`
      );
      return res.json({ success: true, message: 'Payment confirmed', transactionId: t._id });
    }

    if (result.duplicate) {
      // The forwarder retried a message we already processed. Acknowledge so it stops.
      return res.json({ success: true, message: 'Duplicate SMS ignored', duplicate: true });
    }

    if (result.reason === 'no_match') {
      // Real money landed that we cannot attribute to any order. The inbox row keeps it
      // recoverable and the scheduler will nag an operator until it is resolved.
      await notificationService.notifyAdmin(
        `⚠️ <b>Egasi topilmagan to‘lov</b>\n\n` +
          `Summa: ${formatUzs(result.amount || 0)}\n` +
          `Yuboruvchi: ${sender || '—'}\n` +
          `Inbox: <code>${result.inboxId}</code>\n\n` +
          `<i>Hech qaysi kutayotgan buyurtmaga mos kelmadi — qo‘lda tekshiring.</i>`
      );

      // Previously the buyer heard nothing at all here — silence is the scariest failure mode
      // in this whole flow ("I paid, nothing happened, did my money disappear?"). Only sent
      // when exactly one pending order is plausibly theirs, so we never falsely reassure the
      // wrong person.
      if (result.amount) {
        const telegramId = await paymentService.findPlausibleBuyerForAmount(result.amount);
        if (telegramId) {
          await notificationService.notifyPossiblePaymentReceived(telegramId);
        }
      }
    }

    return res.json({
      success: false,
      message: 'No matching pending transaction found',
      reason: result.reason,
      inboxId: result.inboxId,
    });
  } catch (error: any) {
    console.error('[SMS Webhook] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sms-webhook/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'bitmax-sms-webhook' });
});

export default router;
