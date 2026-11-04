// Utilidades compartidas del flujo de autoinstalación (/instalar).
// El prefijo "_" hace que Vercel NO lo publique como función (igual que api/_kb.js).

import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { domainToASCII } from 'node:url';
import { lookup as dnsLookup } from 'node:dns/promises';

/* ============================================================
   FILTRO DE CATEGORÍA — ajustar aquí
   Cada regla bloquea un producto si su texto (título + product_type + tags,
   nunca la descripción) coincide con `any`. Si la regla trae `requires`,
   además debe coincidir al menos uno de esos patrones (p. ej. colágeno solo
   en presentación de suplemento). El texto se normaliza antes: minúsculas,
   NFD y sin tildes, así que los patrones se escriben SIN tildes.
   ============================================================ */
export const CATEGORY_BLOCK_RULES = [
  {
    id: 'proteina',
    any: [
      /\bproteinas?\b/, /\bproteins?\b/, /\bwhey\b/, /\bisolates?\b/,
      /\bcaseinas?\b/, /\bcaseins?\b/,
      // "aislado" a secas también es "termo aislado"; solo cuenta en contexto proteico.
      /\baislados?\s+(?:de\s+)?(?:suero|proteina|whey|soya|soja|arveja|guisante)\b/,
    ],
  },
  {
    id: 'colageno_suplemento',
    any: [/\bcolagenos?\b/, /\bcollagen\b/],
    requires: [
      /\bpolvo\b/, /\bpowder\b/, /\bhidrolizados?\b/, /\bhydroly[sz]ed\b/,
      /\bcapsulas?\b/, /\bcapsules?\b/, /\bsachets?\b/, /\bsobres?\b/, /\bscoops?\b/,
    ],
  },
  { id: 'magnesio', any: [/\bmagnesio\b/, /\bmagnesium\b/] },
  { id: 'creatina', any: [/\bcreatinas?\b/, /\bcreatine\b/] },
  { id: 'pre_entreno', any: [/\bpre[\s-]?entrenos?\b/, /\bpre[\s-]?workouts?\b/] },
  {
    id: 'aminoacidos',
    any: [/\baminoacidos?\b/, /\bamino\b/, /\bbcaas?\b/, /\bglutaminas?\b/, /\bglutamine\b/],
  },
  {
    id: 'ganador_masa',
    any: [/\bganador(?:es)?\s+de\s+(?:masa|peso)\b/, /\bgainers?\b/, /\bmass\s+gainers?\b/],
  },
];

// Umbrales: bloqueado si hay >= BLOCK_MIN_MATCHES productos o >= BLOCK_MIN_SHARE del catálogo.
export const CATEGORY_BLOCK_MIN_MATCHES = 2;
export const CATEGORY_BLOCK_MIN_SHARE = 0.2;
export const CATEGORY_MAX_EVIDENCE = 5;

export function normalizeText(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function productText(p) {
  if (!p || typeof p !== 'object') return '';
  const tags = Array.isArray(p.tags) ? p.tags.join(' | ') : (typeof p.tags === 'string' ? p.tags : '');
  return normalizeText([p.title, p.product_type, tags].filter((x) => typeof x === 'string' && x).join(' | '));
}

export function productMatchesBlock(p) {
  const text = productText(p);
  if (!text) return false;
  return CATEGORY_BLOCK_RULES.some((rule) =>
    rule.any.some((rx) => rx.test(text)) &&
    (!rule.requires || rule.requires.some((rx) => rx.test(text))));
}

/**
 * Clasifica un catálogo (array de productos de /products.json).
 * @returns {{category:'ok'|'review'|'blocked', matches:number, total:number, evidence:string[]}}
 */
export function classify(products) {
  const list = Array.isArray(products) ? products.filter((p) => p && typeof p === 'object') : [];
  const total = list.length;
  const matched = list.filter(productMatchesBlock);
  const matches = matched.length;
  const evidence = matched
    .slice(0, CATEGORY_MAX_EVIDENCE)
    .map((p) => cleanStr(p.title, 140))
    .filter(Boolean);
  let category = 'ok';
  if (matches >= CATEGORY_BLOCK_MIN_MATCHES || (total > 0 && matches / total >= CATEGORY_BLOCK_MIN_SHARE && matches > 0)) {
    category = 'blocked';
  } else if (matches === 1) {
    category = 'review';
  }
  return { category, matches, total, evidence };
}

/* ============================================================
   VALIDACIÓN Y NORMALIZACIÓN
   ============================================================ */
export const RX_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const EMAIL_MAX = 254;
export const RX_CODE = /^\d{6}$/;
export const RX_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
export const RX_MYSHOPIFY = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/;
export const RX_DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
export const STAGES = new Set([
  'email_pending', 'verified', 'provisioning', 'awaiting_link',
  'link_sent', 'installed', 'rejected', 'expired', 'error',
]);
export const INSTALL_LINK_PREFIX = 'https://admin.shopify.com/';

export function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isValidEmail(v) {
  return typeof v === 'string' && v.length <= EMAIL_MAX && RX_EMAIL.test(v);
}

const BLOCKED_HOST_SUFFIXES = [
  '.local', '.internal', '.localhost', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp', '.test', '.invalid', '.example',
];

export function isForbiddenHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h || !h.includes('.')) return true;
  if (h.startsWith('[') || net.isIP(h)) return true;
  if (h === 'localhost') return true;
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

/**
 * Normaliza lo que escribe el comercio:
 *  - "mitienda.com", "https://www.mitienda.com/collections/x"  → custom
 *  - "x.myshopify.com"                                           → myshopify
 *  - "admin.shopify.com/store/x"                                 → x.myshopify.com
 * @returns {{host:string, kind:'myshopify'|'custom'} | null}
 */
export function normalizeShopInput(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s || s.length > 300) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/+/, '');

  const admin = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]{0,62})(?:[/?#]|$)/);
  if (admin) return { host: `${admin[1]}.myshopify.com`, kind: 'myshopify' };

  let host = s.split(/[/?#]/)[0];
  if (!host || host.includes('@') || host.includes(':') || host.includes('\\')) return null;
  host = host.replace(/\.$/, '');
  host = domainToASCII(host);
  if (!host || net.isIP(host)) return null;
  if (host === 'admin.shopify.com' || host === 'shopify.com' || host === 'www.shopify.com') return null;
  if (RX_MYSHOPIFY.test(host)) return { host, kind: 'myshopify' };
  if (!RX_DOMAIN.test(host) || isForbiddenHostname(host)) return null;
  return { host, kind: 'custom' };
}

/* ============================================================
   RED: IP privadas
   ============================================================ */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0) >>> 0;
}

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => {
  const mask = bits === 0 ? 0 : ((0xFFFFFFFF << (32 - bits)) >>> 0);
  return { net: (ipv4ToInt(base) & mask) >>> 0, mask };
});

function isBlockedV4(ip) {
  if (!net.isIPv4(ip)) return true;
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(({ net: base, mask }) => ((n & mask) >>> 0) === base);
}

function expandV6(ip) {
  let s = String(ip).toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  let tailV4 = null;
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    tailV4 = s.slice(lastColon + 1);
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  let groups;
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (tailV4) {
    if (!net.isIPv4(tailV4)) return null;
    const v = ipv4ToInt(tailV4);
    nums[6] = v >>> 16;
    nums[7] = v & 0xFFFF;
  }
  return nums;
}

function v4FromGroups(hi, lo) {
  return [hi >>> 8, hi & 0xFF, lo >>> 8, lo & 0xFF].join('.');
}

function isBlockedV6(ip) {
  const g = expandV6(ip);
  if (!g) return true;
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapeada) y ::a.b.c.d (compatible) → evaluar la IPv4 embebida
  if (zeros(0, 5) && g[5] === 0xFFFF) return isBlockedV4(v4FromGroups(g[6], g[7]));
  if (zeros(0, 6)) return true; // ::, ::1 y compatibles IPv4 (obsoletas)
  // NAT64 64:ff9b::/96 → evaluar la IPv4 embebida; 64:ff9b:1::/48 local → bloquear
  if (g[0] === 0x64 && g[1] === 0xFF9B) {
    if (zeros(2, 6)) return isBlockedV4(v4FromGroups(g[6], g[7]));
    return true;
  }
  // Solo unicast global 2000::/3 (descarta ULA fc00::/7, link-local fe80::/10, multicast ff00::/8, etc.)
  if ((g[0] & 0xE000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] === 0x0DB8) return true; // documentación
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo
  if (g[0] === 0x2002) return true; // 6to4 (puede embeber IPv4 privada)
  return false;
}

export function isPrivateIp(addr) {
  if (net.isIPv4(addr)) return isBlockedV4(addr);
  if (net.isIPv6(addr)) return isBlockedV6(addr);
  return true;
}

/* ============================================================
   SAFE FETCH (solo para leer tiendas de terceros)
   - Solo https, puerto 443, sin credenciales en la URL.
   - Hostname no puede ser IP literal, localhost, *.local, *.internal…
   - DNS resuelto con dns/promises lookup({all:true}); se rechaza si alguna IP
     es privada/loopback/link-local/CGNAT/ULA. La conexión se fija (pin) a la
     IP validada para evitar DNS rebinding entre validación y conexión.
   - Timeout total (AbortController), tamaño máximo en streaming,
     redirecciones manuales con revalidación en cada salto.
   ============================================================ */
export class SafeFetchError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const UA = 'SuscripFyInstallCheck/1.0 (+https://www.suscripfy.co/instalar)';

async function resolvePublicAddress(url) {
  if (url.protocol !== 'https:') throw new SafeFetchError('bad_scheme');
  if (url.username || url.password) throw new SafeFetchError('bad_url');
  if (url.port && url.port !== '443') throw new SafeFetchError('bad_port');
  const host = url.hostname.toLowerCase();
  if (isForbiddenHostname(host)) throw new SafeFetchError('forbidden_host');
  let addrs;
  try {
    addrs = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError('dns');
  }
  if (!Array.isArray(addrs) || !addrs.length) throw new SafeFetchError('dns');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new SafeFetchError('forbidden_address');
  return addrs[0];
}

function httpsGetOnce(url, addr, { signal, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = https.request({
      host: url.hostname,
      servername: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent: false,
      signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        ...headers,
      },
      lookup: (_host, options, cb) => {
        if (options && options.all) cb(null, [{ address: addr.address, family: addr.family }]);
        else cb(null, addr.address, addr.family);
      },
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) {
        res.resume();
        done(resolve, { status, headers: res.headers, body: '' });
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        done(reject, new SafeFetchError('too_large'));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          req.destroy();
          done(reject, new SafeFetchError('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => done(resolve, { status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => done(reject, new SafeFetchError(signal && signal.aborted ? 'timeout' : 'network')));
      res.on('close', () => { if (!res.complete) done(reject, new SafeFetchError(signal && signal.aborted ? 'timeout' : 'network')); });
    });
    req.on('error', () => done(reject, new SafeFetchError(signal && signal.aborted ? 'timeout' : 'network')));
    req.end();
  });
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(input, opts = {}) {
  const {
    timeoutMs = 5000,
    maxBytes = 2 * 1024 * 1024,
    maxRedirects = 3,
    headers = {},
  } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    let url;
    try { url = new URL(input); } catch { throw new SafeFetchError('bad_url'); }
    for (let hop = 0; ; hop += 1) {
      const addr = await resolvePublicAddress(url);
      if (controller.signal.aborted) throw new SafeFetchError('timeout');
      const resp = await httpsGetOnce(url, addr, { signal: controller.signal, maxBytes, headers });
      if (REDIRECT_CODES.has(resp.status)) {
        const loc = resp.headers.location;
        if (!loc) throw new SafeFetchError('bad_redirect');
        if (hop >= maxRedirects) throw new SafeFetchError('too_many_redirects');
        try { url = new URL(loc, url); } catch { throw new SafeFetchError('bad_redirect'); }
        continue;
      }
      return { status: resp.status, headers: resp.headers, body: resp.body, url: url.href };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetchJson(url, opts) {
  try {
    const r = await safeFetch(url, opts);
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `http_${r.status}` };
    try {
      return { ok: true, data: JSON.parse(r.body) };
    } catch {
      return { ok: false, error: 'not_json' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof SafeFetchError ? err.code : 'network' };
  }
}

/* ============================================================
   VERIFICACIÓN DE LA TIENDA (sin el precheck del core)
   ============================================================ */
function makeDeadline(totalMs) {
  const end = Date.now() + totalMs;
  return (cap) => Math.max(0, Math.min(cap, end - Date.now()));
}

/**
 * Lee meta.json, moneda y catálogo de la tienda.
 * Moneda: `currency` de /meta.json (moneda base de la tienda). Si falta, se usa
 * `currency` de /cart.js en el dominio myshopify (moneda de la sesión, que sin
 * localización corresponde al mercado principal).
 */
export async function inspectStore(host, { budgetMs = 9000 } = {}) {
  const remaining = makeDeadline(budgetMs);
  const out = {
    shopify: false,
    myshopify_domain: null,
    store_name: '',
    currency: null,
    cop: null,
    category: null,
    evidence: [],
    catalog_checked: false,
    fetch_error: null,
  };

  const meta = await safeFetchJson(`https://${host}/meta.json`, { timeoutMs: remaining(5000) });
  const m = meta.ok && meta.data && typeof meta.data === 'object' ? meta.data : null;
  const myshopify = m && typeof m.myshopify_domain === 'string' ? m.myshopify_domain.trim().toLowerCase() : '';
  if (!m || !RX_MYSHOPIFY.test(myshopify)) {
    out.fetch_error = meta.ok ? 'not_shopify' : meta.error;
    return out;
  }
  out.shopify = true;
  out.myshopify_domain = myshopify;
  out.store_name = cleanStr(m.name, 120);

  let currency = typeof m.currency === 'string' ? m.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    const cart = await safeFetchJson(`https://${myshopify}/cart.js`, { timeoutMs: remaining(4000) });
    const c = cart.ok && cart.data && typeof cart.data.currency === 'string' ? cart.data.currency.trim().toUpperCase() : '';
    currency = /^[A-Z]{3}$/.test(c) ? c : '';
  }
  out.currency = currency || null;
  out.cop = currency ? currency === 'COP' : false;

  // Catálogo: una sola página (máx. 250). Si excede 2 MB se reintenta con menos productos.
  // Primero el host que escribió el comercio (dominio comercial): Shopify responde 429 a
  // products.json por el .myshopify.com desde IPs de servidor (medido 2026-11-03); luego el myshopify.
  const catalogHosts = host === myshopify ? [myshopify] : [host, myshopify];
  outer:
  for (const h of catalogHosts) {
    for (const limit of [250, 100, 50]) {
      const t = remaining(4000);
      if (t < 500) break outer;
      const prod = await safeFetchJson(`https://${h}/products.json?limit=${limit}`, { timeoutMs: t });
      if (prod.ok && prod.data && Array.isArray(prod.data.products)) {
        const c = classify(prod.data.products);
        out.category = c.category;
        out.evidence = c.evidence;
        out.catalog_checked = true;
        break outer;
      }
      if (prod.error !== 'too_large') break;
    }
  }
  if (!out.catalog_checked) {
    // Catálogo no legible (tienda con contraseña, bloqueo, etc.): se permite pero queda para revisión manual.
    out.category = 'review';
    out.evidence = [];
  }
  return out;
}

/* ============================================================
   CORE (HMAC)
   message = `${timestamp}.${METHOD}.${pathname}.${payload}`
   payload = cuerpo JSON exacto (POST) o query string sin "?" (GET)
   ============================================================ */
export function getCoreConfig() {
  const secret = process.env.INSTALL_INTAKE_SECRET;
  const base = process.env.CORE_API_BASE;
  if (!secret || !base) return null;
  let u;
  try { u = new URL(base); } catch { return null; }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) return null;
  return { secret, base: base.replace(/\/+$/, '') };
}

export function signMessage(secret, timestamp, method, path, payload) {
  const message = `${timestamp}.${String(method).toUpperCase()}.${path}.${payload}`;
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/**
 * @param {{secret:string, base:string}} cfg
 * @param {'GET'|'POST'} method
 * @param {string} path  p. ej. "/public/install/request"
 * @param {{body?:object, query?:string, timeoutMs?:number}} opts  query: ya codificada, sin "?"
 */
export async function callCore(cfg, method, path, { body, query = '', timeoutMs = 8000 } = {}) {
  const m = method.toUpperCase();
  const url = new URL(`${cfg.base}${path}${m === 'GET' && query ? `?${query}` : ''}`);
  const payload = m === 'GET' ? query : JSON.stringify(body == null ? {} : body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signMessage(cfg.secret, timestamp, m, url.pathname, payload);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Suscripfy-Timestamp': timestamp,
    'X-Suscripfy-Signature': signature,
  };
  try {
    const resp = await fetch(url, {
      method: m,
      headers,
      body: m === 'GET' ? undefined : payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
    });
    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: resp.ok, status: resp.status, data: data && typeof data === 'object' ? data : null };
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, status: 0, data: null, error: timeout ? 'timeout' : 'network' };
  }
}

const RX_ERROR_CODE = /^[a-z0-9_]{1,48}$/;

/** Traduce un error del core a una respuesta segura (sin detalles internos). */
export function coreErrorResponse(r) {
  const code = r.data && typeof r.data.error === 'string' && RX_ERROR_CODE.test(r.data.error) ? r.data.error : null;
  const extra = {};
  if (r.data && Number.isInteger(r.data.attempts_left) && r.data.attempts_left >= 0 && r.data.attempts_left <= 100) {
    extra.attempts_left = r.data.attempts_left;
  }
  switch (r.status) {
    case 400:
    case 422: return { status: 400, body: { ok: false, error: code || 'invalid_request', ...extra } };
    case 404: return { status: 404, body: { ok: false, error: code || 'not_found' } };
    case 409: return { status: 409, body: { ok: false, error: code || 'conflict' } };
    case 410: return { status: 410, body: { ok: false, error: code || 'expired' } };
    case 429: return { status: 429, body: { ok: false, error: 'rate_limit' } };
    default: return { status: 502, body: { ok: false, error: 'upstream_unavailable' } };
  }
}

export async function precheckCore(cfg, myshopifyDomain, timeoutMs = 8000) {
  const r = await callCore(cfg, 'POST', '/public/install/precheck', {
    body: { myshopify_domain: myshopifyDomain },
    timeoutMs,
  });
  if (!r.ok || !r.data || typeof r.data.already_installed !== 'boolean') {
    logWarn('precheck', `core status ${r.status}${r.error ? ` (${r.error})` : ''}`);
    return null;
  }
  return { already_installed: r.data.already_installed, open_request: r.data.open_request === true };
}

/* ============================================================
   HTTP helpers
   ============================================================ */
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const raw = typeof xff === 'string' ? xff.split(',')[0].trim() : (req.headers['x-real-ip'] || req.socket?.remoteAddress || '');
  return net.isIP(String(raw)) ? String(raw) : 'unknown';
}

/** Rate limit en memoria por instancia (mismo patrón que api/lead.js). */
export function createRateLimiter({ windowMs, max }) {
  const bucket = new Map();
  return function check(key) {
    const now = Date.now();
    if (bucket.size > 5000) {
      for (const [k, v] of bucket) if (now > v.reset) bucket.delete(k);
    }
    const entry = bucket.get(key);
    if (!entry || now > entry.reset) {
      bucket.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
  };
}

export function sendJson(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(obj);
}

export function readJsonBody(req) {
  let body;
  try { body = req.body; } catch { return null; }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}

export function logWarn(scope, msg) {
  console.warn(`[sf-install][${scope}] ${msg}`);
}
