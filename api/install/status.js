// GET /api/install/status?t=<status_token>
// Estado de la solicitud de instalación (lo consulta /instalar/estado cada 30 s).
import {
  createRateLimiter, getClientIp, sendJson, getCoreConfig, callCore,
  coreErrorResponse, cleanStr, logWarn, RX_TOKEN, STAGES, INSTALL_LINK_PREFIX,
} from './_lib.js';

const rateOk = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

function readToken(req) {
  const q = req.query && req.query.t;
  if (typeof q === 'string') return q.trim();
  try {
    return (new URL(req.url, 'http://localhost').searchParams.get('t') || '').trim();
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!rateOk(getClientIp(req))) return sendJson(res, 429, { ok: false, error: 'rate_limit' });

  const cfg = getCoreConfig();
  if (!cfg) return sendJson(res, 503, { ok: false, error: 'service_unavailable' });

  const token = readToken(req);
  if (!RX_TOKEN.test(token)) return sendJson(res, 400, { ok: false, error: 'invalid_token' });

  try {
    const r = await callCore(cfg, 'GET', '/public/install/status', {
      query: `token=${encodeURIComponent(token)}`,
      timeoutMs: 8000,
    });
    if (!r.ok) {
      logWarn('status', `core status ${r.status}${r.error ? ` (${r.error})` : ''}`);
      const e = coreErrorResponse(r);
      return sendJson(res, e.status, e.body);
    }
    const d = r.data || {};
    const stage = STAGES.has(d.stage) ? d.stage : 'error';
    const out = { ok: true, stage, store_name: cleanStr(d.store_name, 120) };
    if (typeof d.install_link === 'string' && d.install_link.startsWith(INSTALL_LINK_PREFIX) && d.install_link.length <= 2048) {
      try {
        const u = new URL(d.install_link);
        if (u.protocol === 'https:' && u.hostname === 'admin.shopify.com') out.install_link = u.href;
      } catch { /* enlace inválido: se omite */ }
    }
    return sendJson(res, 200, out);
  } catch (err) {
    logWarn('status', `handler error ${err && err.code ? err.code : 'unknown'}`);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}
