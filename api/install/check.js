// POST /api/install/check  { shop }
// Verifica que la tienda sea Shopify, use COP, no tenga SuscripFy y su categoría esté permitida.
import {
  createRateLimiter, getClientIp, sendJson, readJsonBody, getCoreConfig,
  normalizeShopInput, inspectStore, precheckCore, logWarn,
} from './_lib.js';

const rateOk = createRateLimiter({ windowMs: 60 * 1000, max: 10 });
const TOTAL_BUDGET_MS = 14000; // maxDuration 15 s en vercel.json
const UNREACHABLE = new Set(['dns', 'timeout', 'network', 'forbidden_host', 'forbidden_address', 'too_many_redirects', 'bad_redirect']);

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

  const target = normalizeShopInput(typeof body.shop === 'string' ? body.shop : '');
  if (!target) return sendJson(res, 400, { ok: false, error: 'invalid_shop' });

  const started = Date.now();
  try {
    const store = await inspectStore(target.host, { budgetMs: 9000 });

    if (!store.shopify) {
      return sendJson(res, 200, {
        ok: false,
        // unreachable: la dirección no responde (DNS, timeout, red); not_shopify: responde pero no es Shopify.
        reason: UNREACHABLE.has(store.fetch_error) ? 'unreachable' : 'not_shopify',
        myshopify_domain: null,
        store_name: '',
        currency: null,
        checks: { shopify: false, cop: null, no_suscripfy: null, category: null },
        category: null,
        evidence: [],
      });
    }

    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    const pre = await precheckCore(cfg, store.myshopify_domain, Math.min(8000, remaining));
    if (!pre) return sendJson(res, 502, { ok: false, error: 'verification_unavailable' });

    const checks = {
      shopify: true,
      cop: store.cop === true,
      no_suscripfy: !pre.already_installed,
      category: store.category !== 'blocked',
    };
    let reason = null;
    if (!checks.no_suscripfy) reason = 'already_installed';
    else if (!checks.cop) reason = 'not_cop';
    else if (!checks.category) reason = 'category_blocked';

    return sendJson(res, 200, {
      ok: reason === null,
      reason,
      myshopify_domain: store.myshopify_domain,
      store_name: store.store_name,
      currency: store.currency,
      checks,
      category: store.category,
      evidence: store.category === 'ok' ? [] : store.evidence,
      open_request: pre.open_request,
    });
  } catch (err) {
    logWarn('check', `handler error ${err && err.code ? err.code : 'unknown'}`);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}
