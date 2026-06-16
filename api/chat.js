import { SYSTEM_PROMPT } from './_kb.js';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 600;
const TEMPERATURE = 0.3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 12;
const MAX_MSG_LEN = 500;
const MAX_HISTORY = 12;
const SHEETS_LOG_TIMEOUT_MS = 2500;

const rateBucket = new Map(); // key: ip → { count, reset }

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

function sanitize(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, maxLen).trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'rate_limit' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const userMsg = sanitize(body.message, MAX_MSG_LEN);
  if (!userMsg) return res.status(400).json({ error: 'empty_message' });

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const messages = [];
  history.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const role = m.role === 'user' ? 'user' : 'assistant';
    const content = sanitize(m.content, 4000);
    if (content) messages.push({ role, content });
  });
  messages.push({ role: 'user', content: userMsg });

  const lead = (body.lead && typeof body.lead === 'object') ? body.lead : {};
  const leadCtx = [
    lead.nombre ? `Nombre: ${sanitize(lead.nombre, 80)}` : null,
    lead.shopify_url ? `Tienda Shopify: ${sanitize(lead.shopify_url, 200)}` : null,
  ].filter(Boolean).join(' · ');

  const systemPrompt = leadCtx
    ? `${SYSTEM_PROMPT}\n\n## CONTEXTO DEL USUARIO ACTUAL\n${leadCtx}`
    : SYSTEM_PROMPT;

  try {
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages,
      }),
    });

    if (!apiResp.ok) {
      const errTxt = await apiResp.text().catch(() => '');
      console.error('[sf-chat] anthropic error', apiResp.status, errTxt.slice(0, 300));
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await apiResp.json();
    const rawReply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!rawReply) {
      return res.status(502).json({ error: 'empty_reply' });
    }

    // Detectar trigger antes de limpiar el [TRANSFER]
    const hasTransferMarker = rawReply.includes('[TRANSFER]');
    const cleanReply = rawReply.replace(/\[TRANSFER\]/g, '').trim();
    const turno = history.length + 1; // 1-indexed: este es el turno actual del usuario
    let triggerCta = 'no';
    if (hasTransferMarker) triggerCta = 'transfer';
    else if (turno >= 6) triggerCta = 'turnos';

    // Log a Google Sheets (no bloqueante crítico, con timeout corto)
    await logConversationToSheets({
      session_id: sanitize(body.session_id, 60),
      nombre: sanitize(lead.nombre, 80),
      email: sanitize(lead.email, 120),
      whatsapp: sanitize(lead.whatsapp, 12),
      shopify_url: sanitize(lead.shopify_url, 200),
      turno,
      mensaje_usuario: userMsg,
      respuesta_bot: cleanReply,
      trigger_cta: triggerCta,
      ip,
    });

    // Devolvemos el reply RAW (con [TRANSFER]) — el frontend ya lo procesa.
    return res.status(200).json({ reply: rawReply });
  } catch (err) {
    console.error('[sf-chat] handler error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}

// ── Helper: log de conversación a Google Sheets ──────────────────────
async function logConversationToSheets(payload) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const token = process.env.GOOGLE_SHEETS_TOKEN;
  if (!url || !token) {
    console.warn('[sf-chat][log] sheets misconfigured, skipping');
    return;
  }
  const body = JSON.stringify({ kind: 'conversation', token, ...payload });
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), SHEETS_LOG_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const txt = await resp.text().catch(() => '');
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch {}
    if (!resp.ok || !parsed || parsed.ok !== true) {
      console.error('[sf-chat][log] sheets error', resp.status, txt.slice(0, 200));
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      console.warn('[sf-chat][log] sheets timeout');
    } else {
      console.error('[sf-chat][log] sheets exception', err && err.message ? err.message : err);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
