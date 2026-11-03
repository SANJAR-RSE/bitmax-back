import { Router, Request, Response } from 'express';
import { Transaction } from '../models/Transaction';
import { requireInternalKey } from '../middleware/internalAuth';
import { validateObjectId } from '../middleware/validateObjectId';
import { config } from '../config';

const router = Router();

// Exposes buyer/seller PII (telegram ids, usernames) — internal callers only.
router.use(requireInternalKey);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, role, status, page = '1', limit = '20' } = req.query;

    const filter: any = {};
    if (status) filter.status = status;
    if (userId && role === 'buyer') filter.buyerId = userId;
    if (userId && role === 'seller') filter.sellerId = userId;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort('-createdAt')
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('productId', 'title price')
        .populate('buyerId', 'telegramId username')
        .populate('sellerId', 'telegramId username'),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      transactions,
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

router.get('/:id', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('productId')
      .populate('buyerId', 'telegramId username firstName')
      .populate('sellerId', 'telegramId username firstName');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ transaction });
  } catch (error: any) {
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

export default router;
