// The one door every AI feature goes through.
//
// Two providers stand behind it: Cloudflare Workers AI first (the model the
// motolinkers.com site runs on — src/lib/cloudflare-ai.js), Google Gemini as
// the fallback (src/lib/gemini.js). A call tries each configured provider in
// that order and rolls to the next on any failure — out of capacity, rate
// limited, a bad token, a dead network — because the person asking does not
// care which one answered. When every provider fails, the primary's status is
// the one reported (so a 429 still reads as "busy, retry"), and the error
// names each provider's complaint.
//
// The shapes here are provider-neutral. Routes never see a Gemini part or an
// OpenAI message; they send text and tool declarations and get text and tool
// calls back. Nothing throws.

const cf = require('./cloudflare-ai');
const gem = require('./gemini');

const PROVIDERS = [
  { name: 'cloudflare', configured: cf.cloudflareConfigured, call: cf.cloudflareChat },
  { name: 'gemini', configured: gem.geminiConfigured, call: gem.geminiChat },
];
const AI_PROVIDERS = PROVIDERS.map(p => p.name);
const NO_KEY = 'No AI provider is configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY)';

function activeProviders() { return PROVIDERS.filter(p => p.configured()); }
function aiConfigured() { return activeProviders().length > 0; }
function aiProvider() { const p = activeProviders()[0]; return p ? p.name : null; }

// The last real call's outcome, for status lines that must not spend quota
// just to say "connected".
let _state = { ok: null, provider: null, model: null, error: null, status: null, at: 0 };
function aiState() { return { ..._state }; }

// One round trip.
//   { systemText, messages, tools, toolChoice:'auto'|'none', json, generationConfig:{ temperature, maxOutputTokens } }
// messages is the transcript: { role:'user'|'assistant', content } plus, inside
// a tool loop, assistant turns carrying toolCalls and { role:'tool', results }.
// Returns
//   { ok:true, text, toolCalls:[{ id, name, args }], model, provider, raw }
//   { ok:false, noKey:true, error }                     nothing configured
//   { ok:false, error, status, provider, errors:[…] }   every provider failed
async function aiCall(args = {}) {
  const providers = activeProviders();
  if (!providers.length) return { ok: false, noKey: true, error: NO_KEY };
  const errors = [];
  for (const p of providers) {
    let res;
    try { res = await p.call(args); } catch (e) { res = { ok: false, error: e.message || String(e) }; }
    if (res && res.ok) {
      _state = { ok: true, provider: p.name, model: res.model, error: null, status: null, at: Date.now() };
      return { ok: true, text: res.text || '', toolCalls: res.toolCalls || [], model: res.model, provider: p.name, raw: res.raw };
    }
    errors.push({ provider: p.name, error: (res && res.error) || 'unknown error', status: res && res.status });
    console.warn(`[ai] ${p.name} failed: ${(res && res.status) || ''} ${(res && res.error) || ''}`);
  }
  const primary = errors[0];
  const out = { ok: false, provider: primary.provider, status: primary.status,
    error: errors.map(e => `${e.provider}: ${e.error}`).join('; '), errors };
  _state = { ok: false, provider: primary.provider, model: null, error: out.error, status: out.status, at: Date.now() };
  return out;
}

// One conversation with tools. The caller supplies the declarations and a
// `runTool(name, args)` that executes one call; this walks the exchange: at
// most `maxRounds` tool rounds, then one last call in which the model must
// answer in words. Returns
//   { ok:true, text, model, provider, tool_calls:[{ name, args, result }] }
// or the failing aiCall result, never throws.
async function aiConverse({ systemText, history, message, tools, runTool, generationConfig, maxRounds } = {}) {
  const messages = [];
  for (const h of (Array.isArray(history) ? history.slice(-8) : [])) {
    if (!h || !h.content) continue;
    const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant') ? 'assistant' : 'user';
    messages.push({ role, content: String(h.content).slice(0, 2000) });
  }
  messages.push({ role: 'user', content: String(message || '').slice(0, 4000) });
  const gen = { temperature: 0.2, maxOutputTokens: 1500, ...(generationConfig || {}) };
  const toolCalls = [];
  const rounds = Math.max(0, Math.min(8, Number(maxRounds) || 4));
  const withTools = Array.isArray(tools) && tools.length > 0 && typeof runTool === 'function';
  let res = null;
  for (let round = 0; round < (withTools ? rounds : 1); round++) {
    res = await aiCall({ systemText, messages, tools: withTools ? tools : undefined, toolChoice: 'auto', generationConfig: gen });
    if (!res.ok) return res;
    const calls = withTools ? (res.toolCalls || []) : [];
    if (!calls.length) return { ok: true, text: res.text, model: res.model, provider: res.provider, tool_calls: toolCalls };
    messages.push({ role: 'assistant', content: res.text, toolCalls: calls, raw: res.raw, provider: res.provider });
    const results = [];
    for (const c of calls) {
      let result;
      try { result = await runTool(c.name, c.args || {}); } catch (e) { result = { error: e.message }; }
      toolCalls.push({ name: c.name, args: c.args || {}, result });
      results.push({ id: c.id, name: c.name, result });
    }
    messages.push({ role: 'tool', results });
  }
  res = await aiCall({ systemText, messages, tools, toolChoice: 'none', generationConfig: gen });
  return res.ok ? { ok: true, text: res.text, model: res.model, provider: res.provider, tool_calls: toolCalls } : res;
}

module.exports = { AI_PROVIDERS, aiConfigured, aiProvider, aiState, aiCall, aiConverse, detectLang: gem.detectLang, parseAiJson: gem.parseAiJson };
