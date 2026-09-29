// Cloudflare Workers AI, over the OpenAI-compatible REST endpoint.
//
// The motolinkers.com website answers its visitors with
// @cf/meta/llama-3.3-70b-instruct-fp8-fast on Workers AI; this is the same
// model, reached from Railway with an API token instead of a Worker binding.
// One POST per call — no SDK — and nothing here throws: a failed call is a
// result the front door (src/lib/llm.js) can roll past to the next provider.
//
// Wire shape is OpenAI's chat completions: system/user/assistant/tool messages,
// `tools` as JSON-schema functions, `tool_calls` back, `response_format` for
// JSON. The tool declarations the routes carry are in Gemini's shape (a
// functionDeclarations list with UPPERCASE types); toOpenAiTools converts.

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// A second Workers AI model that also does function calling and takes a long
// context, for when the first is out of capacity or the env names a model that
// does not exist. Third-party catalog models (openai/…, anthropic/…) go through
// the same endpoint but need AI Gateway credits, so none is a default.
const FALLBACK_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

function cloudflareModels() {
  const primary = String(process.env.CLOUDFLARE_AI_MODEL || '').trim() || DEFAULT_MODEL;
  return [...new Set([primary, DEFAULT_MODEL, FALLBACK_MODEL])];
}
function cloudflareConfigured() {
  return !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);
}
function endpoint() {
  const base = String(process.env.CLOUDFLARE_AI_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
  return `${base}/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1/chat/completions`;
}

// Gemini-style declarations → OpenAI function tools. Accepts the wrapped form
// ([{ functionDeclarations: [...] }]) and a flat list of declarations; every
// `type` in the schema is lowercased (OBJECT → object) and the rest kept.
function lowerTypes(schema) {
  if (Array.isArray(schema)) return schema.map(lowerTypes);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out[k] = v.toLowerCase();
    else if (k === 'properties' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).map(([n, s]) => [n, lowerTypes(s)]));
    else if (k === 'items') out[k] = lowerTypes(v);
    else out[k] = v;
  }
  return out;
}
function flattenDeclarations(tools) {
  const out = [];
  for (const t of (Array.isArray(tools) ? tools : [])) {
    if (!t) continue;
    if (Array.isArray(t.functionDeclarations)) out.push(...t.functionDeclarations);
    else if (t.function && t.function.name) out.push(t.function);
    else if (t.name) out.push(t);
  }
  return out;
}
function toOpenAiTools(tools) {
  return flattenDeclarations(tools).map(d => ({
    type: 'function',
    function: { name: d.name, description: d.description || '', parameters: lowerTypes(d.parameters || { type: 'object', properties: {} }) },
  }));
}

// The provider-neutral transcript (src/lib/llm.js) → OpenAI messages.
//   { role:'user', content }
//   { role:'assistant', content, toolCalls:[{ id, name, args }] }
//   { role:'tool', results:[{ id, name, result }] }
function toMessages(systemText, transcript) {
  const out = [{ role: 'system', content: String(systemText || '') }];
  for (const m of (Array.isArray(transcript) ? transcript : [])) {
    if (!m) continue;
    if (m.role === 'tool') {
      for (const r of (m.results || [])) out.push({ role: 'tool', tool_call_id: r.id, name: r.name, content: JSON.stringify(r.result === undefined ? null : r.result) });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: String(m.content || '') };
      if (Array.isArray(m.toolCalls) && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
      }
      out.push(msg);
    } else {
      out.push({ role: 'user', content: String(m.content || '') });
    }
  }
  return out;
}

// tool_calls come back as OpenAI's { id, function:{ name, arguments:"json" } };
// the native Workers AI shape is { name, arguments:{…} } and some models omit
// the id. Take all of them.
function parseToolCalls(msg, json) {
  const list = (msg && Array.isArray(msg.tool_calls) && msg.tool_calls) || (Array.isArray(json?.tool_calls) && json.tool_calls) || [];
  return list.map((tc, i) => {
    const fn = tc.function || tc;
    let args = fn.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch (_) { args = { _raw: args }; } }
    if (!args || typeof args !== 'object') args = {};
    return { id: String(tc.id || `call_${i}`), name: String(fn.name || ''), args };
  }).filter(c => c.name);
}

// One request to one model. Returns { ok:true, text, toolCalls, raw } or
// { ok:false, error, status, notFound, busy }.
async function cloudflareGenerate(model, { systemText, messages, tools, toolChoice, json, generationConfig } = {}) {
  const gen = { temperature: 0.3, maxOutputTokens: 800, ...(generationConfig || {}) };
  const body = { model, messages: toMessages(systemText, messages), temperature: gen.temperature, max_tokens: gen.maxOutputTokens };
  // "Answer in words now" is sending no tools at all: tool_choice:"none" is not
  // honoured by every Workers AI model, an absent tool list is.
  const fns = toolChoice === 'none' ? [] : toOpenAiTools(tools);
  if (fns.length) { body.tools = fns; body.tool_choice = 'auto'; }
  if (json) body.response_format = { type: 'json_object' };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}` };
  if (process.env.CLOUDFLARE_AI_GATEWAY) headers['cf-aig-gateway-id'] = process.env.CLOUDFLARE_AI_GATEWAY;
  const init = { method: 'POST', headers, body: JSON.stringify(body) };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(90000);
  let r, raw;
  try { r = await fetch(endpoint(), init); raw = await r.text(); }
  catch (e) { return { ok: false, error: e.message || 'network error', status: 0 }; }
  let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {}
  const errList = Array.isArray(parsed?.errors) ? parsed.errors : (parsed?.error ? [parsed.error] : []);
  const code = Number(errList[0]?.code) || 0;
  if (!r.ok || parsed?.success === false) {
    const message = errList.map(e => e && (e.message || e.msg)).filter(Boolean).join('; ') || raw.slice(0, 300) || ('HTTP ' + r.status);
    const status = r.ok ? 500 : r.status;
    return { ok: false, error: message, status, code,
      notFound: status === 404 || code === 5007 || /no such model|not found|model not/i.test(message),
      busy: status === 429 || code === 3040 };
  }
  const msg = parsed?.choices?.[0]?.message || parsed?.result?.choices?.[0]?.message || null;
  const text = String((msg && msg.content) || parsed?.result?.response || parsed?.response || '').trim();
  return { ok: true, text, toolCalls: parseToolCalls(msg, parsed?.result || parsed), raw: parsed };
}

// Walk the model list: roll on "no such model" (a typo in CLOUDFLARE_AI_MODEL)
// and on capacity, stop on anything else — a bad request or a bad token is bad
// against every model.
async function cloudflareChat(args) {
  let last = null;
  for (const model of cloudflareModels()) {
    const res = await cloudflareGenerate(model, args);
    if (res.ok) return { ok: true, text: res.text, toolCalls: res.toolCalls, model, raw: res.raw };
    last = res;
    console.warn(`[cloudflare-ai] ${model} failed: ${res.status || ''} ${res.error}`);
    if (!res.notFound && !res.busy) break;
  }
  return { ok: false, error: last ? last.error : 'unknown error', status: last ? (last.busy ? 429 : last.status) : undefined };
}

module.exports = { DEFAULT_MODEL, FALLBACK_MODEL, cloudflareModels, cloudflareConfigured, cloudflareChat, cloudflareGenerate, toOpenAiTools, toMessages, parseToolCalls, lowerTypes };
