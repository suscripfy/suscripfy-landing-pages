import { SYSTEM_PROMPT } from './_kb.js';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 600;
const TEMPERATURE = 0.3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 12;
const MAX_MSG_LEN = 500;
const MAX_HISTORY = 12;

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
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!reply) {
      return res.status(502).json({ error: 'empty_reply' });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[sf-chat] handler error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
