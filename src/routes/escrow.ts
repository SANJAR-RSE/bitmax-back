import { Router, Request, Response } from 'express';
import { EscrowHold } from '../models/EscrowHold';
import { paymentService, AlreadyProcessedError } from '../services/paymentService';
import { requireInternalKey } from '../middleware/internalAuth';
import { validateObjectId } from '../middleware/validateObjectId';
import { config } from '../config';

const router = Router();

// Everything here exposes buyer/seller PII and/or moves money — internal callers only
// (the bot process). There is currently no public dashboard that needs this over HTTP.
router.use(requireInternalKey);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, userId, role, page = '1', limit = '20' } = req.query;

    const filter: any = {};
    if (status) filter.status = status;
    if (userId && role === 'buyer') filter.buyerId = userId;
    if (userId && role === 'seller') filter.sellerId = userId;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    const [holds, total] = await Promise.all([
      EscrowHold.find(filter)
        .sort('-createdAt')
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('productId', 'title price')
        .populate('buyerId', 'telegramId username')
        .populate('sellerId', 'telegramId username'),
      EscrowHold.countDocuments(filter),
    ]);

    res.json({
      holds,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

router.post('/:id/refund', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ error: 'Refund reason is required' });
    }

    const result = await paymentService.processRefund(req.params.id, reason);
    res.json(result);
  } catch (error: any) {
    if (error instanceof AlreadyProcessedError) {
      return res.status(409).json({ error: error.message });
    }
    if (error.message === 'Escrow hold not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

router.post('/:id/confirm', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const result = await paymentService.confirmAndRelease(req.params.id);
    res.json(result);
  } catch (error: any) {
    if (error instanceof AlreadyProcessedError) {
      return res.status(409).json({ error: error.message });
    }
    if (error.message === 'Escrow hold not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

router.get('/:id', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const hold = await EscrowHold.findById(req.params.id)
      .populate('productId')
      .populate('buyerId', 'telegramId username firstName')
      .populate('sellerId', 'telegramId username firstName');

    if (!hold) {
      return res.status(404).json({ error: 'Escrow hold not found' });
    }

    res.json({ hold });
  } catch (error: any) {
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

export default router;
