import {
  STAFF_EMAILS, verifyPassword, signSession,
  buildCookieHeader, SESSION_TTL_SECONDS, getClientIp,
} from './_session.js';

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_MAX = 5;
const attemptBucket = new Map();

function checkAttempts(ip) {
  const now = Date.now();
  const entry = attemptBucket.get(ip);
  if (!entry || now > entry.reset) {
    attemptBucket.set(ip, { count: 1, reset: now + ATTEMPT_WINDOW_MS });
    return true;
  }
  if (entry.count >= ATTEMPT_MAX) return false;
  entry.count += 1;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!process.env.STAFF_PASSWORD || !process.env.STAFF_SESSION_SECRET) {
    return res.status(500).json({ error: 'misconfigured' });
  }
  const ip = getClientIp(req);
  if (!checkAttempts(ip)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const passwordOk = verifyPassword(password);
  const emailOk = STAFF_EMAILS.has(email);
  if (!passwordOk || !emailOk) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const cookieValue = signSession(email);
  res.setHeader('Set-Cookie', buildCookieHeader(cookieValue, SESSION_TTL_SECONDS));
  return res.status(200).json({ ok: true, email });
}
