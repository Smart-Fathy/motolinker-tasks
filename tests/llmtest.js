// The AI front door: Cloudflare Workers AI first, Gemini as the fallback.
//
// No network. `fetch` is stubbed and every request it sees is kept, so the
// checks read the exact bodies the providers send — the OpenAI message shape
// on the Cloudflare side, the v1beta shape on the Gemini side — and the
// exact results the routes get back, without spending anyone's quota.
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_TOKEN', 'CLOUDFLARE_AI_MODEL', 'CLOUDFLARE_AI_GATEWAY', 'CLOUDFLARE_AI_BASE', 'GEMINI_API_KEY', 'GEMINI_MODEL']) delete process.env[k];
const llm = require(process.cwd() + '/src/lib/llm.js');
const cf = require(process.cwd() + '/src/lib/cloudflare-ai.js');
const gem = require(process.cwd() + '/src/lib/gemini.js');

// ── The stub ──────────────────────────────────────────────────────────────────
let calls = [];
let script = [];       // one entry per request, in order: { status, body } or a function(req) → that
global.fetch = async (url, init) => {
  const req = { url: String(url), headers: (init && init.headers) || {}, body: JSON.parse((init && init.body) || '{}') };
  calls.push(req);
  let step = script.length ? script.shift() : { status: 200, body: {} };
  if (typeof step === 'function') step = step(req);
  if (step.throw) throw new Error(step.throw);
  const status = step.status || 200;
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof step.body === 'string' ? step.body : JSON.stringify(step.body)) };
};
const reset = (s) => { calls = []; script = s || []; };
const cfOk = (content, extra) => ({ status: 200, body: { id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, ...(extra || {}) }, finish_reason: 'stop' }] } });
const gemOk = (parts) => ({ status: 200, body: { candidates: [{ content: { role: 'model', parts } }] } });
const TOOLS = [{ functionDeclarations: [
  { name: 'finance_query', description: 'read a figure', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', enum: ['sum_payments', 'po_list'] }, limit: { type: 'INTEGER' }, overdue: { type: 'BOOLEAN' }, budget: { type: 'NUMBER' } }, required: ['query'] } },
  { name: 'calculate', description: 'exact arithmetic', parameters: { type: 'OBJECT', properties: { expression: { type: 'STRING' } }, required: ['expression'] } },
] }];
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

(async () => {
  // ── Nothing configured ─────────────────────────────────────────────────────
  check('nothing configured: aiConfigured is false and the provider is null', !llm.aiConfigured() && llm.aiProvider() === null);
  {
    const r = await llm.aiCall({ systemText: 'x', messages: [{ role: 'user', content: 'hi' }] });
    check('nothing configured: the call reports noKey, names both settings, and touches no network', r.ok === false && r.noKey === true && /CLOUDFLARE_AI_TOKEN/.test(r.error) && /GEMINI_API_KEY/.test(r.error) && calls.length === 0);
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acct123';
  process.env.CLOUDFLARE_AI_TOKEN = 'tok-secret';
  check('Cloudflare alone is enough, and it is the primary', llm.aiConfigured() && llm.aiProvider() === 'cloudflare' && llm.AI_PROVIDERS[0] === 'cloudflare');
  check('the default model is the one the motolinkers.com site runs on', cf.cloudflareModels()[0] === '@cf/meta/llama-3.3-70b-instruct-fp8-fast' && cf.DEFAULT_MODEL === '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

  // ── Request shape ──────────────────────────────────────────────────────────
  reset([cfOk('{"highlights":["a"]}')]);
  {
    const r = await llm.aiCall({ systemText: 'SYS', messages: [{ role: 'user', content: 'Analyse.' }, { role: 'assistant', content: 'earlier' }, { role: 'user', content: 'now' }],
      tools: TOOLS, json: true, generationConfig: { temperature: 0.2, maxOutputTokens: 1234 } });
    const q = calls[0];
    check('cloudflare: the OpenAI-compatible endpoint under the account id, with the bearer token', /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/acct123\/ai\/v1\/chat\/completions$/.test(q.url) && q.headers.Authorization === 'Bearer tok-secret' && !('cf-aig-gateway-id' in q.headers), q.url);
    const b = q.body;
    check('cloudflare: system first, then the transcript as user/assistant', b.model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast' && b.messages[0].role === 'system' && b.messages[0].content === 'SYS' && b.messages[1].role === 'user' && b.messages[2].role === 'assistant' && b.messages[3].content === 'now', JSON.stringify(b.messages));
    check('cloudflare: maxOutputTokens becomes max_tokens; json becomes response_format', b.max_tokens === 1234 && b.temperature === 0.2 && b.response_format && b.response_format.type === 'json_object');
    const t = b.tools || [];
    check('cloudflare: the Gemini declarations are flattened into OpenAI function tools', t.length === 2 && t[0].type === 'function' && t[0].function.name === 'finance_query' && t[1].function.name === 'calculate' && b.tool_choice === 'auto', JSON.stringify(t.map(x => x.function.name)));
    const p = t[0].function.parameters;
    check('cloudflare: schema types are lowercased and enum/required are kept', p.type === 'object' && p.properties.query.type === 'string' && p.properties.query.enum[1] === 'po_list' && p.properties.limit.type === 'integer' && p.properties.overdue.type === 'boolean' && p.properties.budget.type === 'number' && p.required[0] === 'query', JSON.stringify(p));
    check('cloudflare: the answer comes back with text, provider and model', r.ok && r.text === '{"highlights":["a"]}' && r.provider === 'cloudflare' && r.model === '@cf/meta/llama-3.3-70b-instruct-fp8-fast' && r.toolCalls.length === 0);
    check('parseAiJson still reads it', llm.parseAiJson(r.text).highlights[0] === 'a');
    const st = llm.aiState();
    check('aiState remembers the provider and model of the last real call', st.ok === true && st.provider === 'cloudflare' && st.model === r.model && st.at > 0);
  }
  process.env.CLOUDFLARE_AI_GATEWAY = 'gw1';
  process.env.CLOUDFLARE_AI_MODEL = 'openai/gpt-4.1';
  reset([cfOk('hi')]);
  await llm.aiCall({ systemText: 's', messages: [{ role: 'user', content: 'u' }] });
  check('an env model and a gateway id are honoured', calls[0].body.model === 'openai/gpt-4.1' && calls[0].headers['cf-aig-gateway-id'] === 'gw1' && !calls[0].body.tools && !calls[0].body.response_format);
  delete process.env.CLOUDFLARE_AI_GATEWAY; delete process.env.CLOUDFLARE_AI_MODEL;

  // ── Tool calls in the answer ───────────────────────────────────────────────
  check('tool_calls: OpenAI string arguments, native object arguments, and a missing id', (() => {
    const out = cf.parseToolCalls({ tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"1+1"}' } },
      { function: { name: 'finance_query', arguments: { query: 'po_list' } } },
      { name: 'calculate', arguments: 'not json' },
    ] });
    return out.length === 3 && out[0].id === 'c1' && out[0].args.expression === '1+1' && out[1].id === 'call_1' && out[1].args.query === 'po_list' && out[2].args._raw === 'not json';
  })());

  // ── The loop ───────────────────────────────────────────────────────────────
  reset([
    cfOk(null, { tool_calls: [{ id: 'c9', type: 'function', function: { name: 'calculate', arguments: '{"expression":"12% * 1000"}' } }] }),
    cfOk('It is 120.'),
  ]);
  {
    const seen = [];
    const r = await llm.aiConverse({ systemText: 'S', history: [{ role: 'user', content: 'a' }, { role: 'bot', content: 'b' }], message: 'what is 12% of 1000',
      tools: TOOLS, runTool: (name, args) => { seen.push(name); return { expression: args.expression, result: 120 }; } });
    check('converse: the tool ran once and the answer carries it', r.ok && r.text === 'It is 120.' && r.provider === 'cloudflare' && seen.length === 1 && r.tool_calls.length === 1 && r.tool_calls[0].name === 'calculate' && r.tool_calls[0].result.result === 120, JSON.stringify(r));
    const first = calls[0].body, second = calls[1].body;
    check('converse: history roles become user/assistant', first.messages[1].role === 'user' && first.messages[2].role === 'assistant' && first.messages[3].content === 'what is 12% of 1000' && first.tools.length === 2);
    const asst = second.messages[4], tool = second.messages[5];
    check('converse: the model turn goes back with its tool_calls, then one tool message per call', asst.role === 'assistant' && asst.tool_calls[0].id === 'c9' && asst.tool_calls[0].function.name === 'calculate' && typeof asst.tool_calls[0].function.arguments === 'string' && tool.role === 'tool' && tool.tool_call_id === 'c9' && tool.name === 'calculate' && JSON.parse(tool.content).result === 120, JSON.stringify(second.messages.slice(4)));
    check('converse: the model keeps its tools until it answers in words', second.tools && second.tools.length === 2 && second.tool_choice === 'auto');
  }
  // Rounds run out → the last call carries no tools at all, so the model must answer.
  reset([
    cfOk(null, { tool_calls: [{ id: 'a', function: { name: 'calculate', arguments: '{"expression":"1"}' } }] }),
    cfOk(null, { tool_calls: [{ id: 'b', function: { name: 'calculate', arguments: '{"expression":"2"}' } }] }),
    cfOk('done'),
  ]);
  {
    const r = await llm.aiConverse({ systemText: 'S', message: 'm', tools: TOOLS, maxRounds: 2, runTool: () => ({ result: 1 }) });
    check('converse: after the last round the final call sends no tools and no tool_choice', r.ok && r.text === 'done' && r.tool_calls.length === 2 && calls.length === 3 && !('tools' in calls[2].body) && !('tool_choice' in calls[2].body), JSON.stringify(Object.keys(calls[2].body)));
  }

  // ── Falling back to Gemini ─────────────────────────────────────────────────
  process.env.GEMINI_API_KEY = 'gk';
  const restore = quiet();
  reset([{ status: 429, body: { success: false, errors: [{ code: 3040, message: 'Capacity temporarily exceeded, please try again.' }] } },
         { status: 429, body: { success: false, errors: [{ code: 3040, message: 'Capacity temporarily exceeded, please try again.' }] } },
         gemOk([{ text: 'from gemini' }])]);
  {
    const r = await llm.aiCall({ systemText: 'S', messages: [{ role: 'user', content: 'u' }], json: true });
    const cfCalls = calls.filter(c => /api\.cloudflare\.com/.test(c.url)), gCalls = calls.filter(c => /generativelanguage\.googleapis\.com/.test(c.url));
    check('capacity on Cloudflare rolls to its second model, then to Gemini, which answers', r.ok && r.text === 'from gemini' && r.provider === 'gemini' && cfCalls.length === 2 && gCalls.length === 1, JSON.stringify({ cf: cfCalls.map(c => c.body.model), g: gCalls.map(c => c.url.replace(/\?.*/, '')) }));
    check('cloudflare rolled through its own list in order', cfCalls[0].body.model === cf.DEFAULT_MODEL && cfCalls[1].body.model === cf.FALLBACK_MODEL);
    const gb = gCalls[0].body;
    check('gemini gets the v1beta shape: system_instruction, contents with parts, JSON mime', gb.system_instruction.parts[0].text === 'S' && gb.contents[0].role === 'user' && gb.contents[0].parts[0].text === 'u' && gb.generationConfig.responseMimeType === 'application/json' && /key=gk/.test(gCalls[0].url));
    check('aiState now says gemini', llm.aiState().provider === 'gemini' && llm.aiState().ok === true);
  }
  reset([{ status: 401, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } }, gemOk([{ text: 'g' }])]);
  {
    const r = await llm.aiCall({ systemText: 'S', messages: [{ role: 'user', content: 'u' }] });
    check('a bad Cloudflare token does not stop Gemini from answering (one Cloudflare try, no model rolling)', r.ok && r.provider === 'gemini' && calls.filter(c => /cloudflare/.test(c.url)).length === 1);
  }
  reset([{ status: 429, body: { errors: [{ code: 3040, message: 'busy' }] } }, { status: 429, body: { errors: [{ code: 3040, message: 'busy' }] } },
         { status: 429, body: { error: { message: 'high demand' } } }, { status: 429, body: { error: { message: 'high demand' } } }, { status: 429, body: { error: { message: 'high demand' } } }, { status: 429, body: { error: { message: 'high demand' } } }]);
  {
    const r = await llm.aiCall({ systemText: 'S', messages: [{ role: 'user', content: 'u' }] });
    check('both busy: the result is a 429 naming each provider', r.ok === false && r.status === 429 && /cloudflare: busy/.test(r.error) && /gemini: high demand/.test(r.error) && r.errors.length === 2 && r.provider === 'cloudflare', JSON.stringify(r));
    check('aiState records the failure', llm.aiState().ok === false && llm.aiState().status === 429 && /gemini/.test(llm.aiState().error));
  }
  reset([{ status: 401, body: { errors: [{ code: 10000, message: 'bad token' }] } }, { status: 403, body: { error: { message: 'key invalid' } } }]);
  {
    const r = await llm.aiCall({ systemText: 'S', messages: [{ role: 'user', content: 'u' }] });
    check('both misconfigured: the primary provider\'s status is reported, so it is not mistaken for "busy"', r.ok === false && r.status === 401 && /cloudflare: bad token; gemini: key invalid/.test(r.error), JSON.stringify(r));
  }
  reset([{ throw: 'ECONNRESET' }, gemOk([{ text: 'g' }])]);
  {
    const r = await llm.aiCall({ systemText: 'S', messages: [{ role: 'user', content: 'u' }] });
    check('a dead network on the Cloudflare side is a result, not a throw, and Gemini answers', r.ok && r.provider === 'gemini' && r.errors === undefined && calls.length === 2, JSON.stringify(r));
  }
  restore();

  // ── Gemini alone, as before ────────────────────────────────────────────────
  delete process.env.CLOUDFLARE_ACCOUNT_ID; delete process.env.CLOUDFLARE_AI_TOKEN;
  check('Gemini alone is enough', llm.aiConfigured() && llm.aiProvider() === 'gemini');
  reset([gemOk([{ text: 'thinking', thoughtSignature: 'sig' }, { functionCall: { name: 'calculate', args: { expression: '2*3' } } }]), gemOk([{ text: 'Six.' }])]);
  {
    const r = await llm.aiConverse({ systemText: 'S', message: 'two times three', tools: TOOLS, runTool: (n, a) => ({ expression: a.expression, result: 6 }) });
    check('gemini converse: the tool ran and the words came back', r.ok && r.text === 'Six.' && r.provider === 'gemini' && r.tool_calls[0].result.result === 6, JSON.stringify(r));
    const first = calls[0].body, second = calls[1].body;
    check('gemini: tools go through untouched with mode AUTO', first.tools === undefined ? false : first.tools[0].functionDeclarations[0].parameters.type === 'OBJECT' && first.toolConfig.functionCallingConfig.mode === 'AUTO');
    const model = second.contents[1], resp = second.contents[2];
    check('gemini: the model turn goes back verbatim (signature and all), then one functionResponse per call', model.role === 'model' && model.parts[0].thoughtSignature === 'sig' && model.parts[1].functionCall.name === 'calculate' && resp.role === 'user' && resp.parts[0].functionResponse.name === 'calculate' && resp.parts[0].functionResponse.response.result.result === 6, JSON.stringify(second.contents));
    check('gemini: it keeps AUTO until it answers in words', second.toolConfig.functionCallingConfig.mode === 'AUTO');
  }
  reset([gemOk([{ functionCall: { name: 'calculate', args: { expression: '1' } } }]), gemOk([{ functionCall: { name: 'calculate', args: { expression: '2' } } }]), gemOk([{ text: 'fin' }])]);
  {
    const r = await llm.aiConverse({ systemText: 'S', message: 'm', tools: TOOLS, maxRounds: 2, runTool: () => ({ result: 1 }) });
    check('gemini: after the last round the final call is mode NONE', r.ok && r.text === 'fin' && calls[2].body.toolConfig.functionCallingConfig.mode === 'NONE');
  }
  // A transcript that began on Cloudflare and continues on Gemini is rebuilt from
  // the neutral tool calls, not from the other provider's raw payload.
  {
    const contents = gem.toContents([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'calculate', args: { expression: '1+1' } }], raw: { choices: [] }, provider: 'cloudflare' }, { role: 'tool', results: [{ id: 'c1', name: 'calculate', result: { result: 2 } }] }]);
    check('gemini: a Cloudflare-made turn is rebuilt as a functionCall part', contents[1].role === 'model' && contents[1].parts[0].functionCall.name === 'calculate' && contents[1].parts[0].functionCall.args.expression === '1+1' && contents[2].parts[0].functionResponse.response.result.result === 2, JSON.stringify(contents));
  }
  {
    const msgs = cf.toMessages('S', [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'x', toolCalls: [], raw: [{ text: 'x' }], provider: 'gemini' }]);
    check('cloudflare: a Gemini-made turn is a plain assistant message without an empty tool_calls list', msgs[2].role === 'assistant' && msgs[2].content === 'x' && !('tool_calls' in msgs[2]));
  }
  delete process.env.GEMINI_API_KEY;
  {
    const r = await gem.geminiCall({ systemText: 'x', contents: [] });
    check('the Gemini client on its own still reports noKey without throwing', r.ok === false && r.noKey === true);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
