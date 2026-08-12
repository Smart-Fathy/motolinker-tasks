// Help Bot (bilingual
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { ADMIN_USERNAME, express, receiver, requireAuth, requireEmployeeAuth, upload } = ctx.need('ADMIN_USERNAME', 'express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'upload');

// ─── Help Bot (bilingual EN/AR support assistant) ───────────────────────────────
// Hybrid: instant curated FAQ, with an optional Google Gemini (free tier) fallback
// when GEMINI_API_KEY is set. Never throws — always returns some answer.
const HELP_FAQ = [
  { keys: ['add lead','new lead','create lead','اضافة عميل','إضافة عميل','عميل جديد','ليد جديد'],
    en: 'To add a lead: open Leads → click "Add Lead", fill in the name (required), phone, status, budget, etc., then Save. To add many at once use "Import CSV" (upload a .csv file or paste a public Google Sheets link).',
    ar: 'لإضافة عميل: افتح قسم Leads ثم اضغط "Add Lead"، واملأ الاسم (مطلوب) والهاتف والحالة والميزانية ثم احفظ. ولإضافة عدة عملاء دفعة واحدة استخدم "Import CSV" (ارفع ملف .csv أو الصق رابط Google Sheets عام).' },
  { keys: ['lead 360','360','profile','timeline','follow up','follow-up','activity','بروفايل','ملف العميل','متابعة','نشاط','الجدول الزمني'],
    en: 'Click a lead\'s name to open the Lead 360° drawer: the activity timeline, follow-ups (schedule and mark done), and linked quotations and deals. Use "Log" to record a call, note, WhatsApp or meeting.',
    ar: 'اضغط على اسم العميل لفتح بطاقة Lead 360°: الجدول الزمني للنشاط، والمتابعات (جدولة وإتمام)، وعروض الأسعار والصفقات المرتبطة. استخدم "Log" لتسجيل مكالمة أو ملاحظة أو واتساب أو اجتماع.' },
  { keys: ['column','columns','add column','delete column','custom field','عمود','أعمدة','حذف عمود','حقل مخصص'],
    en: 'In Leads, click any column header to Rename, Change type, Edit dropdown options, Hide, Move, or Delete it — including built-in columns. Use the "Columns" button to show/hide columns and "+" to add a custom one.',
    ar: 'في قسم Leads، اضغط على رأس أي عمود لإعادة التسمية أو تغيير النوع أو تعديل خيارات القائمة أو الإخفاء أو النقل أو الحذف — بما في ذلك الأعمدة الأساسية. استخدم زر "Columns" لإظهار/إخفاء الأعمدة و"+" لإضافة عمود مخصص.' },
  { keys: ['deal','deals','pipeline','stage','kanban','صفقة','صفقات','مرحلة','خط الأنابيب'],
    en: 'Deals is a kanban pipeline. Drag a card between stages (Lead → Contacted → Quoted → Negotiating → Won/Lost), or open a card to edit it. Create one with "Add Deal".',
    ar: 'قسم Deals عبارة عن لوحة كانبان. اسحب البطاقة بين المراحل (Lead ← Contacted ← Quoted ← Negotiating ← Won/Lost)، أو افتح البطاقة لتعديلها. أنشئ صفقة عبر "Add Deal".' },
  { keys: ['edit quotation','update quotation','تعديل عرض','تعديل عرض سعر'],
    en: 'To edit a saved quotation: open Quotation → History → "Edit". It loads into the draft (including its images); clicking Generate then updates that same quotation instead of creating a new one. "Duplicate" makes a copy with a new ID.',
    ar: 'لتعديل عرض سعر محفوظ: افتح Quotation ثم History ثم "Edit". سيُحمَّل في المسودة (مع صوره)؛ والضغط على Generate يحدّث نفس العرض بدلاً من إنشاء عرض جديد. أما "Duplicate" فينشئ نسخة برقم جديد.' },
  { keys: ['quotation','quote','pdf','عرض سعر','عرض السعر','كوتيشن','عرض الأسعار'],
    en: 'Open Quotation to build a PDF: fill the ID, customer, vehicle, items, logistics and exchange rate, add up to 5 images, then click "Generate PDF". Saved quotes live under History where you can Edit, Duplicate or Delete them.',
    ar: 'افتح قسم Quotation لإنشاء ملف PDF: املأ الرقم والعميل والسيارة والبنود والشحن وسعر الصرف، أضف حتى 5 صور، ثم اضغط "Generate PDF". تظهر العروض المحفوظة في History حيث يمكنك تعديلها أو نسخها أو حذفها.' },
  { keys: ['automation','automations','rule','trigger','أتمتة','قاعدة','تشغيل تلقائي','مشغل'],
    en: 'Automations (admin) run "when X happens, do Y". Pick a trigger (e.g. a deal\'s stage changes), optional conditions, then actions (notify, assign lead, edit lead, set status, create follow-up/task/deal, or request a deletion). Turn the rule on to activate it.',
    ar: 'الأتمتة (للمدير) تعمل بمبدأ "عند حدوث X نفّذ Y". اختر مُشغّلاً (مثل تغيّر مرحلة الصفقة)، وشروطاً اختيارية، ثم إجراءات (إشعار، إسناد عميل، تعديل عميل، ضبط الحالة، إنشاء متابعة/مهمة/صفقة، أو طلب حذف). فعِّل القاعدة لتشغيلها.' },
  { keys: ['task','tasks','مهمة','مهام'],
    en: 'Tasks lets you create and assign work with due dates, priorities and multiple assignees, and comment on each task. Employees see their items under "My Tasks".',
    ar: 'قسم Tasks يتيح إنشاء المهام وإسنادها مع تواريخ استحقاق وأولويات ومسؤولين متعددين، والتعليق على كل مهمة. يرى الموظفون مهامهم في "My Tasks".' },
  { keys: ['hours','log hours','timesheet','ساعات','تسجيل ساعات','دوام'],
    en: 'Use Hours / Log Hours to record time spent; admins review totals under Hours Logs.',
    ar: 'استخدم Hours / Log Hours لتسجيل الوقت المستغرق؛ ويراجع المديرون الإجماليات في Hours Logs.' },
  { keys: ['request','requests','vacation','leave','طلب','طلبات','اجازة','إجازة'],
    en: 'Requests handles internal requests (e.g. leave). Submit one from Requests; admins can assign and comment, and you get notified on updates.',
    ar: 'قسم Requests يدير الطلبات الداخلية (مثل الإجازات). قدّم طلباً من Requests؛ ويمكن للمديرين إسناده والتعليق عليه، وتصلك إشعارات بالتحديثات.' },
  { keys: ['delete lead','delete deal','remove lead','deletion','approve deletion','حذف','طلب حذف','حذف عميل','حذف صفقة'],
    en: 'Employees can\'t delete leads/deals directly — clicking Delete sends a request to an admin, who approves it on the "Deletion Requests" page before the record is actually removed.',
    ar: 'لا يستطيع الموظفون حذف العملاء/الصفقات مباشرة — الضغط على Delete يرسل طلباً للمدير، الذي يوافق عليه من صفحة "Deletion Requests" قبل حذف السجل فعلياً.' },
  { keys: ['permission','permissions','access','grant','صلاحية','صلاحيات','وصول','منح صلاحية'],
    en: 'Admins set each employee\'s access under Employees → edit an employee → toggle sections (leads, deals, quotation, etc.). Hidden sections won\'t appear in that employee\'s portal.',
    ar: 'يحدد المديرون صلاحيات كل موظف من Employees ثم تعديل الموظف ثم تفعيل الأقسام (leads، deals، quotation، إلخ). الأقسام المخفية لن تظهر في بوابة ذلك الموظف.' },
  { keys: ['import','csv','sheet','spreadsheet','استيراد','اكسل','شيت','جدول'],
    en: 'In Leads → "Import CSV" you can upload a .csv file or paste a public Google Sheets URL. Columns like name/phone/status/origin/car/budget are matched automatically and duplicate phone numbers are skipped.',
    ar: 'من Leads ثم "Import CSV" يمكنك رفع ملف .csv أو لصق رابط Google Sheets عام. تتم مطابقة الأعمدة مثل name/phone/status/origin/car/budget تلقائياً ويتم تجاهل أرقام الهاتف المكررة.' },
  { keys: ['chat','message','دردشة','شات','رسالة','مراسلة'],
    en: 'Chat is the internal team messaging — direct and group rooms, file sharing and push notifications.',
    ar: 'قسم Chat هو المراسلة الداخلية للفريق — محادثات فردية وجماعية ومشاركة ملفات وإشعارات فورية.' },
  { keys: ['notification','notifications','اشعار','إشعار','إشعارات','تنبيه'],
    en: 'Notifications lists your alerts (mentions, assignments, approvals, follow-up reminders). Enable browser/push notifications to receive them on your device.',
    ar: 'قسم Notifications يعرض تنبيهاتك (الإشارات والإسنادات والموافقات وتذكيرات المتابعة). فعّل إشعارات المتصفح/الهاتف لتصلك على جهازك.' },
  // ── Section overviews (bare-word queries) — kept LAST so specific entries above match first ──
  { keys: ['lead','leads','عملاء','العملاء','ليدز'],
    en: 'Leads is your database of potential customers. Add or import leads, edit any cell inline, configure columns, and click a lead\'s name to open its 360° profile (activity, follow-ups, quotations, deals). Ask me "how to add a lead", "import leads", or "lead columns" for steps.',
    ar: 'قسم Leads هو قاعدة بيانات عملائك المحتملين. أضف أو استورد العملاء، عدّل أي خلية مباشرةً، خصّص الأعمدة، واضغط على اسم العميل لفتح ملفه 360° (النشاط، المتابعات، عروض الأسعار، الصفقات). اسألني "كيف أضيف عميل" أو "استيراد العملاء" أو "أعمدة العملاء" للخطوات.' },
  { keys: ['deal','deals','صفقة','صفقات','الصفقات'],
    en: 'Deals is your sales pipeline as a kanban board (Lead → Contacted → Quoted → Negotiating → Won/Lost). Drag cards between stages or open one to edit. Ask "how to add a deal" for steps.',
    ar: 'قسم Deals هو مسار المبيعات على شكل لوحة كانبان (Lead ← Contacted ← Quoted ← Negotiating ← Won/Lost). اسحب البطاقات بين المراحل أو افتح بطاقة لتعديلها. اسأل "كيف أضيف صفقة" للخطوات.' },
];
function helpDetectLang(text) { return /[؀-ۿ]/.test(String(text || '')) ? 'ar' : 'en'; }
function helpFaqMatch(message, lang) {
  const m = String(message || '').toLowerCase();
  if (!m.trim()) return null;
  for (const item of HELP_FAQ) {
    if (item.keys.some(k => m.includes(k.toLowerCase()))) return lang === 'ar' ? item.ar : item.en;
  }
  return null;
}
function helpSystemPrompt(identity) {
  const id = identity || {};
  const who = id.role === 'admin'
    ? `an ADMIN with full access to the admin dashboard. Their admin username is "${id.username || 'admin'}".`
    : `a TEAM member using the employee (Team) portal. Their name is "${id.name || ''}", username "${id.username || ''}"${id.job_title ? `, job title "${id.job_title}"` : ''}.`;
  const perms = (id.role !== 'admin' && id.permissions)
    ? `The sections they are allowed to use: ${Object.keys(id.permissions).filter(k => id.permissions[k] === true).join(', ') || '(basic only)'}.`
    : '';
  return [
    'You are the MotoLinker Help Bot, a friendly in-app support assistant for a car-sales CRM (leads, deals, quotations, tasks).',
    `The person asking is ${who}`,
    perms,
    'Answer ONLY questions about how to use this system, plus simple questions about the user themselves (e.g. their username/name/role — use the identity above).',
    'Be concise and practical: prefer short numbered steps that name the exact on-screen section and button. If something is not possible, say so plainly and give the closest alternative.',
    'Reply in the SAME language as the user (Arabic or English). For Arabic use clear Modern Standard Arabic.',
    '',
    'SECTIONS:',
    '- Leads: a table with configurable columns — click a column header to Rename / Change type / Edit dropdown options / Hide / Move / Delete (any column, built-in too); "Columns" button toggles visibility; "+" adds a custom column. Inline-edit a cell by clicking it. "Add Lead" adds one; "Import CSV" bulk-imports a .csv file or a public Google Sheets link (dedupes by phone). Click a lead name to open the Lead 360° drawer: activity timeline (Log a call/note/whatsapp/meeting), follow-ups (schedule + mark done), linked quotations and deals.',
    '- Deals: a kanban pipeline with stages Lead, Contacted, Quoted, Negotiating, Won, Lost. Drag a card between stages, or open it to edit. "Add Deal" creates one.',
    '- Quotation: build a PDF (ID, customer/lead, vehicle, items, logistics, exchange rate, up to 5 images). "Generate PDF" saves it to History. In History: Edit (loads it back and updates the SAME quote incl. its images), Duplicate (a copy with a new ID), Delete.',
    '- Tasks (assign work with due date/priority/multiple assignees + comments), Hours (log time), Requests (internal requests with assignment + comments).',
    '- Chat (team messaging), Notifications, Submissions (website-form leads), Reports (analytics).',
    '- Deletion Requests (admin): employees can\'t delete leads/deals directly — their Delete files a request an admin approves here. Permissions are set per employee under Employees.',
    '',
    'AUTOMATIONS (admin only — the Automations section): each rule is WHEN a trigger fires / ONLY IF optional conditions match / THEN actions run. Turn the rule ON to activate it.',
    'Triggers: a lead is created; a lead\'s status changes; a lead is marked contacted; a deal is created; a deal\'s stage changes; a quotation is generated; a lead has no activity for N days.',
    'Condition fields: source, lead_status, stage, been_contacted, budget_lead, budget_egp, name, car_in_question, and "to" (the new value on a change). Operators: is, is not, contains, changed to, >, <, is empty, is not empty. For status/stage/origin the value is a dropdown of the real options.',
    'IMPORTANT LIMITATION: conditions can only match the NEW/current value (e.g. lead_status is "warm", or "to" is "warm") — there is NO "from/previous value" field. So a rule like "status changes to Warm FROM Hot" can only be built as: trigger = "a lead\'s status changes", condition = lead_status is Warm. It cannot restrict what the previous status was. Tell the user this explicitly when they ask for a from→to rule.',
    'Actions: Send a notification (admin / lead owner / specific rep); Create a follow-up; Create a task; Create a deal; Set lead status; Assign the lead to a rep (round-robin or specific); Edit the lead profile (set fields); Remove the lead from deals (needs admin approval); Delete the lead (needs admin approval). Notification title/body support {{name}} and {{phone}} placeholders. Lead-scoped actions on a quotation trigger only run if the quote is linked to a lead.',
    '',
    'If a question is truly outside this system, say so briefly and point to the closest relevant section.',
  ].filter(Boolean).join('\n');
}
// Candidate models: env override first, then current free-tier fallbacks. gemini-2.0-flash was shut
// down 2026-06-01, so defaults target the live Flash / Flash-Lite models. Self-heals on 404 or 429.
const GEMINI_MODELS = (() => {
  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const list = [primary, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
  return [...new Set(list)];
})();
// Cached result of the most recent real Gemini call, so the admin status line never spends quota.
let _helpAiState = { ok: null, model: null, error: null, status: null, at: 0 };
async function geminiGenerate(model, key, systemText, contents) {
  const body = { system_instruction: { parts: [{ text: systemText }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 800 } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const raw = await r.text();
  let json = null; try { json = JSON.parse(raw); } catch (_) {}
  if (!r.ok) {
    const err = new Error(json?.error?.message || raw.slice(0, 300) || ('HTTP ' + r.status));
    err.status = r.status; err.notFound = r.status === 404 || /not found|not supported/i.test(err.message);
    return { ok: false, err };
  }
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
  return { ok: true, text: text || '' };
}
// Returns { ok, text, model } on success, or { ok:false, noKey?, error, status } on failure. Never throws.
async function helpCallGemini(systemText, history, message) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, noKey: true };
  const contents = [];
  for (const h of (Array.isArray(history) ? history.slice(-8) : [])) {
    if (!h || !h.content) continue;
    const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant') ? 'model' : 'user';
    contents.push({ role, parts: [{ text: String(h.content).slice(0, 2000) }] });
  }
  contents.push({ role: 'user', parts: [{ text: String(message).slice(0, 2000) }] });
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await geminiGenerate(model, key, systemText, contents);
      if (res.ok) { _helpAiState = { ok: true, model, error: null, status: null, at: Date.now() }; return { ok: true, text: res.text, model }; }
      lastErr = res.err;
      console.warn(`[help] gemini ${model} failed: ${res.err.status || ''} ${res.err.message}`);
      // Roll to the next model when this one is missing/unsupported (404) OR rate-limited (429 —
      // each model has an independent free-tier bucket). Stop on other errors (400/403/5xx).
      if (!res.err.notFound && res.err.status !== 429) break;
    } catch (e) { lastErr = e; console.warn(`[help] gemini ${model} threw: ${e.message}`); break; }
  }
  const result = { ok: false, error: lastErr ? lastErr.message : 'unknown error', status: lastErr?.status };
  _helpAiState = { ok: false, model: null, error: result.error, status: result.status, at: Date.now() };
  return result;
}
// Live health check for the admin status line: actually pings the model.
async function helpGeminiPing() {
  if (!process.env.GEMINI_API_KEY) return { ai: false, ok: false };
  const res = await helpCallGemini('You are a health check. Reply with the single word OK.', [], 'ping');
  return res.ok ? { ai: true, ok: true, model: res.model } : { ai: true, ok: false, error: res.error, status: res.status };
}
async function handleHelpChat(req, res, identity) {
  try {
    const message = String(req.body?.message || '').slice(0, 4000);
    if (!message.trim()) return res.status(400).json({ error: 'message required' });
    const lang = (req.body?.lang === 'ar' || req.body?.lang === 'en') ? req.body.lang : helpDetectLang(message);
    let aiError = null;
    // AI-FIRST: when a key is configured, let the model answer (it has the full system prompt + identity).
    if (process.env.GEMINI_API_KEY) {
      const ai = await helpCallGemini(helpSystemPrompt(identity), req.body?.history, message);
      if (ai.ok && ai.text) return res.json({ answer: ai.text, source: 'ai' });
      if (!ai.noKey) { aiError = ai.error; console.warn('[help] AI unavailable, falling back to FAQ:', ai.error); }
      // Rate-limited on every model → tell the user plainly (+ a guide answer if one matches).
      if (ai.status === 429) {
        const faqRl = helpFaqMatch(message, lang);
        const busy = lang === 'ar'
          ? 'المساعد الذكي مشغول حالياً (تجاوز حد الاستخدام المجاني) — من فضلك حاول مرة أخرى بعد بضع ثوانٍ.'
          : 'The AI assistant is busy right now (free-tier rate limit) — please try again in a few seconds.';
        return res.json({ answer: busy + (faqRl ? '\n\n' + faqRl : ''), source: 'ratelimit' });
      }
    }
    // Fallback: curated FAQ, then a generic pointer.
    const faq = helpFaqMatch(message, lang);
    if (faq) return res.json({ answer: faq, source: 'faq' });
    const fallback = lang === 'ar'
      ? 'لم أجد إجابة جاهزة لسؤالك. يمكنك السؤال عن: العملاء (Leads)، الصفقات (Deals)، عروض الأسعار (Quotation)، المهام (Tasks)، الطلبات (Requests)، الأتمتة (Automations)، الاستيراد، أو الصلاحيات — أو اذكر اسم القسم الذي تحتاج مساعدة فيه.'
      : "I couldn't find a ready answer. Try asking about: Leads, Deals, Quotation, Tasks, Requests, Automations, Import, or Permissions — or name the section you need help with.";
    const out = { answer: fallback, source: 'fallback' };
    if (identity.role === 'admin' && aiError) out.debug = 'AI error: ' + aiError; // admin-only diagnostics
    return res.json(out);
  } catch (e) {
    console.error('[help-chat]', e);
    res.status(500).json({ error: e.message });
  }
}
receiver.router.post('/api/dashboard/help/chat', requireAuth, express.json(), (req, res) => handleHelpChat(req, res, { role: 'admin', username: ADMIN_USERNAME, name: 'Admin' }));
receiver.router.post('/api/employee/help/chat', requireEmployeeAuth, express.json(), (req, res) => handleHelpChat(req, res, { role: 'employee', ...req.employee }));
// Admin-only: is the AI (Gemini) configured AND working? Uses the cached result of the last real
// call (updated on every chat) so opening the panel never spends quota; only pings live if nothing
// has been observed in the last 10 minutes.
receiver.router.get('/api/dashboard/help/status', requireAuth, async (_req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.json({ ai: false, ok: false });
  const fresh = _helpAiState.at && (Date.now() - _helpAiState.at < 10 * 60 * 1000);
  if (fresh) return res.json({ ai: true, ok: _helpAiState.ok, model: _helpAiState.model, error: _helpAiState.error, status: _helpAiState.status, tested: true });
  try { res.json({ ...(await helpGeminiPing()), tested: true }); }
  catch (e) { res.json({ ai: true, ok: false, error: e.message, tested: true }); }
});


module.exports = {};
