import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

/**
 * Rejects requests whose `:id` route param isn't a valid Mongo ObjectId before they
 * reach a query — avoids leaking a raw Mongoose CastError (and its stack) as a 500.
 */
export function validateObjectId(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (!mongoose.isValidObjectId(value)) {
      return res.status(400).json({ error: `Invalid ${paramName}` });
    }
    return next();
  };
}
