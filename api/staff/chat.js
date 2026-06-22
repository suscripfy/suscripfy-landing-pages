import { SYSTEM_PROMPT } from '../_kb.js';
import { verifySession, readCookie, getClientIp } from './_session.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const MAX_MSG_LEN = 2000;
const MAX_HISTORY = 12;

const rateBucket = new Map();

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

  const sess = verifySession(readCookie(req));
  if (!sess) return res.status(401).json({ error: 'unauthorized' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'misconfigured' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'rate_limit' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  const userMsg = sanitize(body.message, MAX_MSG_LEN);
  if (!userMsg) return res.status(400).json({ error: 'empty_message' });

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const messages = [];
  history.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const role = m.role === 'user' ? 'user' : 'assistant';
    const content = sanitize(m.content, 8000);
    if (content) messages.push({ role, content });
  });
  messages.push({ role: 'user', content: userMsg });

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
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
    if (!apiResp.ok) {
      const errTxt = await apiResp.text().catch(() => '');
      console.error('[sf-staff] anthropic error', apiResp.status, errTxt.slice(0, 300));
      return res.status(502).json({ error: 'upstream_error' });
    }
    const data = await apiResp.json();
    const rawReply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!rawReply) return res.status(502).json({ error: 'empty_reply' });

    const cleanReply = rawReply.replace(/\[TRANSFER\]/g, '').trim();
    return res.status(200).json({ reply: cleanReply });
  } catch (err) {
    console.error('[sf-staff] handler error', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
