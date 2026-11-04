// POST /api/install/resend  { myshopify_domain }
// Solicitud en curso (ya pasó del código): el core reenvía el estado (o el link de instalación) al
// correo con el que se hizo la solicitud. Respuesta sin datos personales: { ok, sent }.
// Con el core de producción anterior (sin el endpoint) el core responde 404 → { ok:false, error:'not_available' }.
import {
  createRateLimiter, getClientIp, sendJson, readJsonBody, getCoreConfig, callCore, logWarn, RX_MYSHOPIFY,
} from './_lib.js';

const rateOk = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!rateOk(getClientIp(req))) return sendJson(res, 429, { ok: false, error: 'rate_limit' });

  const cfg = getCoreConfig();
  if (!cfg) return sendJson(res, 503, { ok: false, error: 'service_unavailable' });

  const body = readJsonBody(req);
  if (!body) return sendJson(res, 400, { ok: false, error: 'invalid_body' });
  const domain = typeof body.myshopify_domain === 'string' ? body.myshopify_domain.trim().toLowerCase() : '';
  if (!RX_MYSHOPIFY.test(domain)) return sendJson(res, 400, { ok: false, error: 'invalid_shop' });

  const r = await callCore(cfg, 'POST', '/public/install/resend', { body: { myshopify_domain: domain }, timeoutMs: 8000 });
  if (r.ok && r.data && typeof r.data.sent === 'boolean') return sendJson(res, 200, { ok: true, sent: r.data.sent });
  logWarn('resend', `core status ${r.status}${r.error ? ` (${r.error})` : ''}`);
  if (r.status === 404) return sendJson(res, 404, { ok: false, error: 'not_available' });
  if (r.status === 429) return sendJson(res, 429, { ok: false, error: 'rate_limit' });
  return sendJson(res, 502, { ok: false, error: 'upstream_unavailable' });
}
