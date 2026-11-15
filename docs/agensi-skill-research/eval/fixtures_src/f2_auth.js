const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error('JWT_SECRET must be set'); //@DECOY d1 fails closed at startup
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    const claims = jwt.decode(token); //@BUG b1 decode does not verify the signature
    req.user = await db.users.findById(claims.sub);
    if (!req.user) return res.status(401).json({ error: 'unknown user' });
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role = 'admin') { //@BUG b2 assignment instead of comparison
    return next();
  }
  return res.status(403).json({ error: 'forbidden' });
}

async function revokeSessions(req, res) {
  const limit = parseInt(req.query.limit, 10) || 50; //@DECOY d2 radix given, sane default
  const sessions = await db.sessions.listByUser(req.params.id, limit);
  const total = sessions.length;
  const startedAt = Date.now();
  sessions.forEach(async (s) => { //@BUG b3 async callback not awaited; response sent before deletes finish, rejections unhandled
    await db.sessions.delete(s.id);
  });
  res.json({ revoked: total, startedAt });
}

module.exports = { authenticate, requireAdmin, revokeSessions, SECRET };
