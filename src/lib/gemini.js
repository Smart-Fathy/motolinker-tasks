// One Gemini client for every feature that talks to the model.
//
// The Help bot carried its own copy of this inside src/routes/help-bot.js. The
// Accounting section needs the same call with two more things — function
// calling and JSON mode — and two copies of "walk the model list, roll to the
// next one on 404 or 429, stop on anything else" is how they drift apart the
// first time one of them is fixed. So the call lives here and both use it.
//
// Nothing in this file throws: a failed call is a result, not an exception.
// No SDK — the REST API is one POST, and the SDK would be the only dependency
// in the project that exists to save a fetch.

// Candidate models: env override first, then current free-tier fallbacks.
// gemini-2.0-flash was shut down 2026-06-01, so defaults target the live Flash /
// Flash-Lite models. Each model has an independent free-tier quota bucket, which
// is why a 429 rolls to the next one rather than giving up.
const GEMINI_MODELS = (() => {
  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const list = [primary, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
  return [...new Set(list)];
})();
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function geminiConfigured() { return !!process.env.GEMINI_API_KEY; }

// Arabic script anywhere in the text means the person is writing Arabic.
function detectLang(text) { return /[؀-ۿ]/.test(String(text || '')) ? 'ar' : 'en'; }

// Result of the most recent real call, for status lines that must not spend
// quota just to say "connected".
let _state = { ok: null, model: null, error: null, status: null, at: 0 };
function geminiState() { return { ..._state }; }

// One request to one model. `opts` may carry generationConfig (merged over the
// defaults), tools and toolConfig — the function-calling shape of v1beta.
// Returns { ok:true, text, parts, raw } or { ok:false, err } where err.status is
// the HTTP status and err.notFound says the model itself was the problem.
async function geminiGenerate(model, key, systemText, contents, opts) {
  const o = opts || {};
  const body = {
    system_instruction: { parts: [{ text: String(systemText || '') }] },
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 800, ...(o.generationConfig || {}) },
  };
  if (o.tools) body.tools = o.tools;
  if (o.toolConfig) body.toolConfig = o.toolConfig;
  const r = await fetch(`${API_BASE}${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const raw = await r.text();
  let json = null; try { json = JSON.parse(raw); } catch (_) {}
  if (!r.ok) {
    const err = new Error(json?.error?.message || raw.slice(0, 300) || ('HTTP ' + r.status));
    err.status = r.status; err.notFound = r.status === 404 || /not found|not supported/i.test(err.message);
    return { ok: false, err };
  }
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  return { ok: true, text, parts, raw: json };
}

// The call every feature makes. Walks the model list; returns
//   { ok:true, text, parts, model }            on success
//   { ok:false, noKey:true, error }            when no key is configured
//   { ok:false, error, status }                when every candidate failed
async function geminiCall({ systemText, contents, tools, toolConfig, generationConfig } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, noKey: true, error: 'GEMINI_API_KEY is not set' };
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await geminiGenerate(model, key, systemText, contents, { tools, toolConfig, generationConfig });
      if (res.ok) {
        _state = { ok: true, model, error: null, status: null, at: Date.now() };
        return { ok: true, text: res.text, parts: res.parts, model, raw: res.raw };
      }
      lastErr = res.err;
      console.warn(`[gemini] ${model} failed: ${res.err.status || ''} ${res.err.message}`);
      // Roll to the next model when this one is missing/unsupported (404) OR
      // rate-limited (429). Stop on other errors (400/403/5xx): a bad request
      // is bad against every model, and a 403 is the key.
      if (!res.err.notFound && res.err.status !== 429) break;
    } catch (e) { lastErr = e; console.warn(`[gemini] ${model} threw: ${e.message}`); break; }
  }
  const out = { ok: false, error: lastErr ? lastErr.message : 'unknown error', status: lastErr?.status };
  _state = { ok: false, model: null, error: out.error, status: out.status, at: Date.now() };
  return out;
}

// The model was asked for JSON and usually complies — sometimes inside a ```json
// fence, sometimes after a sentence. Take the first object or array in the text.
// Returns null rather than throwing: the caller decides what an unparsable
// answer means.
function parseAiJson(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const starts = [s.indexOf('{'), s.indexOf('[')].filter(i => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const closer = s[start] === '{' ? '}' : ']';
  const end = s.lastIndexOf(closer);
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
}

module.exports = { GEMINI_MODELS, geminiConfigured, geminiGenerate, geminiCall, geminiState, detectLang, parseAiJson };
