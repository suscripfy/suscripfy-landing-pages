import crypto from 'node:crypto';

// Whitelist de emails autorizados (no es secret; lista cerrada).
export const STAFF_EMAILS = new Set([
  'administracion@suscripfy.co',
  'oscar@suscripfy.co',
  'comercial@suscripfy.co',
  'soporte@suscripfy.co',
  'laura@suscripfy.co',
  'it@suscripfy.co',
  'lauraramirezmalaver@gmail.com',
  'osalgore@gmail.com',
]);

export const COOKIE_NAME = 'sf_staff_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 horas

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return Buffer.from(s, 'base64');
}

// Compara la password recibida contra STAFF_PASSWORD (env var) de forma
// timing-safe para evitar leaks por tiempo de respuesta.
export function verifyPassword(plain) {
  const stored = process.env.STAFF_PASSWORD;
  if (!stored || typeof plain !== 'string') return false;
  const a = Buffer.from(plain, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Firma payload {email, exp} con HMAC-SHA256 → cookie value.
export function signSession(email) {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) throw new Error('missing_secret');
  const payload = JSON.stringify({
    email: String(email).toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const payloadB64 = b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return payloadB64 + '.' + b64urlEncode(sig);
}

// Verifica cookie value → devuelve {email} si OK, null si inválida/expirada.
export function verifySession(cookieValue) {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  let sigBuf, expectedSig;
  try {
    sigBuf = b64urlDecode(sigB64);
    expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  } catch { return null; }
  if (sigBuf.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedSig)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')); }
  catch { return null; }
  if (!payload || typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!STAFF_EMAILS.has(payload.email)) return null;
  return { email: payload.email };
}

export function buildCookieHeader(value, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}
export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export function readCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = String(raw).split(';');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === COOKIE_NAME) return p.slice(eq + 1).trim();
  }
  return null;
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
