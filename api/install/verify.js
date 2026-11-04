// POST /api/install/verify  { status_token, code }
// Confirma el correo con el código de 6 dígitos que envió el core.
import {
  createRateLimiter, getClientIp, sendJson, readJsonBody, getCoreConfig,
  callCore, coreErrorResponse, logWarn, RX_TOKEN, RX_CODE, STAGES,
} from './_lib.js';

const rateOk = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10 });

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

  const token = typeof body.status_token === 'string' ? body.status_token.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!RX_TOKEN.test(token)) return sendJson(res, 400, { ok: false, error: 'invalid_token' });
  if (!RX_CODE.test(code)) return sendJson(res, 400, { ok: false, error: 'invalid_code' });

  try {
    const r = await callCore(cfg, 'POST', '/public/install/verify', {
      body: { status_token: token, code },
      timeoutMs: 8000,
    });
    if (!r.ok) {
      logWarn('verify', `core status ${r.status}${r.error ? ` (${r.error})` : ''}`);
      const e = coreErrorResponse(r);
      return sendJson(res, e.status, e.body);
    }
    const stage = r.data && r.data.stage;
    return sendJson(res, 200, { ok: true, stage: STAGES.has(stage) ? stage : 'verified' });
  } catch (err) {
    logWarn('verify', `handler error ${err && err.code ? err.code : 'unknown'}`);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}
