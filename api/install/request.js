// POST /api/install/request
//   { myshopify_domain, email, terms_accepted, shop_input?, verdict }
// Valida el veredicto firmado de check.js (no reclasifica ni vuelve a leer el catálogo), repite en el
// servidor Shopify/COP/precheck y registra la solicitud en el core, que envía el código de 6 dígitos.
import {
  createRateLimiter, getClientIp, sendJson, readJsonBody, getCoreConfig,
  inspectStore, precheckCore, callCore, coreErrorResponse, cleanStr,
  maskEmail, logWarn, verifyVerdict, validateContact, RX_MYSHOPIFY, RX_TOKEN, STAGES,
} from './_lib.js';

const rateOk = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
const TOTAL_BUDGET_MS = 14000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  const ip = getClientIp(req);
  if (!rateOk(ip)) return sendJson(res, 429, { ok: false, error: 'rate_limit' });

  const cfg = getCoreConfig();
  if (!cfg) return sendJson(res, 503, { ok: false, error: 'service_unavailable' });

  const body = readJsonBody(req);
  if (!body) return sendJson(res, 400, { ok: false, error: 'invalid_body' });

  const domain = typeof body.myshopify_domain === 'string' ? body.myshopify_domain.trim().toLowerCase() : '';
  if (!RX_MYSHOPIFY.test(domain)) return sendJson(res, 400, { ok: false, error: 'invalid_shop' });
  const c = validateContact(body);
  if (!c.ok) return sendJson(res, 400, { ok: false, error: c.error });
  const email = c.email;
  const verdict = verifyVerdict(cfg.secret, body.verdict, domain);
  if (!verdict) return sendJson(res, 400, { ok: false, error: 'verification_expired' });
  if (verdict.c === 'blocked') return sendJson(res, 422, { ok: false, error: 'category_blocked' });
  const shopInput = cleanStr(body.shop_input, 200) || domain;

  const started = Date.now();
  try {
    const store = await inspectStore(domain, { budgetMs: 7000, catalog: false });
    if (!store.shopify || store.myshopify_domain !== domain) {
      return sendJson(res, 422, { ok: false, error: 'not_shopify' });
    }
    if (!store.cop) return sendJson(res, 422, { ok: false, error: 'not_cop' });

    const pre = await precheckCore(cfg, domain, Math.min(4000, TOTAL_BUDGET_MS - (Date.now() - started) - 4500));
    if (!pre) return sendJson(res, 502, { ok: false, error: 'verification_unavailable' });
    if (pre.already_installed) return sendJson(res, 409, { ok: false, error: 'already_installed' });

    const payload = {
      myshopify_domain: domain,
      shop_input: shopInput,
      store_name: store.store_name,
      currency: store.currency,
      email,
      terms_accepted: true,
      category: verdict.c === 'review' ? 'review' : 'ok',
      category_evidence: verdict.e,
      category_source: verdict.s,
      category_reason: verdict.r,
      client_ip: ip === 'unknown' ? '' : ip,
    };
    const r = await callCore(cfg, 'POST', '/public/install/request', {
      body: payload,
      timeoutMs: Math.max(1000, Math.min(8000, TOTAL_BUDGET_MS - (Date.now() - started))),
    });
    if (!r.ok) {
      logWarn('request', `core status ${r.status}${r.error ? ` (${r.error})` : ''} shop=${domain} email=${maskEmail(email)}`);
      const e = coreErrorResponse(r);
      return sendJson(res, e.status, e.body);
    }
    const token = r.data && r.data.status_token;
    const stage = r.data && r.data.stage;
    if (typeof token !== 'string' || !RX_TOKEN.test(token)) {
      logWarn('request', 'core response without valid status_token');
      return sendJson(res, 502, { ok: false, error: 'upstream_unavailable' });
    }
    return sendJson(res, 200, {
      ok: true,
      status_token: token,
      stage: STAGES.has(stage) ? stage : 'email_pending',
    });
  } catch (err) {
    logWarn('request', `handler error ${err && err.code ? err.code : 'unknown'}`);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}
