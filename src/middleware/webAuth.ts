import { Request, Response, NextFunction } from 'express';
import { User, IUser } from '../models/User';
import { SessionClaims, verifySession } from '../utils/jwt';

export interface AuthedRequest extends Request {
  authUser: IUser;
  claims: SessionClaims;
}

/**
 * Guards every `/api/me/*` route: the caller must present a session token this server signed,
 * for a user that still exists, is not blocked, and has not logged out everywhere since.
 *
 * The token is deliberately *not* trusted on its own. It carries the user id, but role,
 * balance and block status are read fresh from the database on every request — a token minted
 * a week ago must not keep a since-blocked scammer trading, and must not carry a stale role
 * that grants more than the account has now.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });

  const claims = verifySession(token);
  if (!claims) return res.status(401).json({ error: 'Sessiya yaroqsiz yoki muddati tugagan' });

  const user = await User.findById(claims.sub).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Sessiya yaroqsiz yoki muddati tugagan' });

  if (user.webSessionsValidFrom && claims.iat * 1000 < user.webSessionsValidFrom.getTime()) {
    return res.status(401).json({ error: 'Sessiya bekor qilingan — qaytadan kiring' });
  }
  if (user.isBlocked) {
    return res.status(403).json({ error: user.blockReason || 'Hisobingiz bloklangan' });
  }

  (req as AuthedRequest).authUser = user;
  (req as AuthedRequest).claims = claims;
  return next();
}
