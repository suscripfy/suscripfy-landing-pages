// POST /api/install/check  { email, terms_accepted, shop }
// Paso 1 de /instalar (post-demo): valida correo + términos, verifica que la tienda sea Shopify, use
// COP, no tenga SuscripFy y su sector esté permitido (IA; las reglas quedan como alarma). No envía
// lead al sheet (el lead ya existe en Cal.com). Si pasa, devuelve un veredicto firmado (30 min) que
// request.js valida sin volver a leer el catálogo.
import {
  createRateLimiter, getClientIp, sendJson, readJsonBody, getCoreConfig,
  normalizeShopInput, inspectStore, precheckCore, classifyCatalog, fallbackCategory,
  validateContact, signVerdict, cleanStr, logWarn,
} from './_lib.js';

const rateOk = createRateLimiter({ windowMs: 60 * 1000, max: 10 });
// Presupuesto (maxDuration 30 s): inspectStore 7 s + (IA 10 s ‖ precheck 4 s).
const STORE_BUDGET_MS = 7000;
const PRECHECK_MS = 4000;
const UNREACHABLE = new Set(['dns', 'timeout', 'network', 'forbidden_host', 'forbidden_address', 'too_many_redirects', 'bad_redirect']);

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

  const v = validateContact(body);
  if (!v.ok) return sendJson(res, 400, { ok: false, error: v.error });
  const shopInput = cleanStr(typeof body.shop === 'string' ? body.shop : '', 300);

  const target = normalizeShopInput(shopInput);
  if (!target) {
    return sendJson(res, 400, { ok: false, error: 'invalid_shop' });
  }

  try {
    const store = await inspectStore(target.host, { budgetMs: STORE_BUDGET_MS });

    if (!store.shopify) {
      // unreachable: la dirección no responde (DNS, timeout, red); not_shopify: responde pero no es Shopify.
      const reason = UNREACHABLE.has(store.fetch_error) ? 'unreachable' : 'not_shopify';
      return sendJson(res, 200, {
        ok: false,
        reason,
        myshopify_domain: null,
        store_name: '',
        currency: null,
        checks: { shopify: false, cop: null, no_suscripfy: null, category: null },
        category: null,
        evidence: [],
      });
    }

    const [pre, cat] = await Promise.all([
      precheckCore(cfg, store.myshopify_domain, PRECHECK_MS),
      store.catalog_checked
        ? classifyCatalog({ storeName: store.store_name, products: store.products })
        // Catálogo no legible (tienda con contraseña, bloqueo, etc.): se permite pero queda para revisión.
        : Promise.resolve(fallbackCategory('Catálogo no legible.')),
    ]);
    if (!pre) {
      return sendJson(res, 502, { ok: false, error: 'verification_unavailable' });
    }

    const checks = {
      shopify: true,
      cop: store.cop === true,
      no_suscripfy: !pre.already_installed,
      category: cat.category !== 'blocked',
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
      category: cat.category,
      evidence: cat.category === 'ok' ? [] : cat.evidence,
      open_request: pre.open_request,
      open_stage: pre.open_stage,
      ...(reason === null ? {
        verdict: signVerdict(cfg.secret, {
          d: store.myshopify_domain, c: cat.category, e: cat.evidence, s: cat.source, r: cat.reason,
        }),
      } : {}),
    });
  } catch (err) {
    logWarn('check', `handler error ${err && err.code ? err.code : 'unknown'}`);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}
