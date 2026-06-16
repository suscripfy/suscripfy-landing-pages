const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateBucket = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateBucket.get(ip);
  if (!entry || now > entry.reset) {
    rateBucket.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}
function s(v, max) { return String(v || '').slice(0, max).replace(/[\u0000-\u001F\u007F]/g, ''); }

const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RX_PHONE = /^3\d{9}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'rate_limit' });
  }

  if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL || !process.env.GOOGLE_SHEETS_TOKEN) {
    return res.status(500).json({ error: 'misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const nombre = s(body.nombre, 80);
  const email = s(body.email, 120).toLowerCase();
  const whatsapp = s(body.whatsapp, 12).replace(/\D/g, '').replace(/^57/, '');
  const shopify_url = s(body.shopify_url, 200);
  const session_id = s(body.session_id, 60);
  const origen = s(body.origen, 40) || 'landing-chat';

  if (!nombre || nombre.length < 2) return res.status(400).json({ error: 'invalid_nombre' });
  if (!RX_EMAIL.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!RX_PHONE.test(whatsapp)) return res.status(400).json({ error: 'invalid_whatsapp' });
  if (!shopify_url) return res.status(400).json({ error: 'invalid_shopify' });

  const payload = {
    token: process.env.GOOGLE_SHEETS_TOKEN,
    nombre, email, whatsapp, shopify_url, session_id, origen,
    ip, user_agent: s(req.headers['user-agent'], 250),
  };

  try {
    const resp = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    if (!resp.ok) {
      console.error('[sf-chat] sheets error', resp.status);
      return res.status(502).json({ error: 'sheets_upstream' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[sf-chat] lead handler error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
