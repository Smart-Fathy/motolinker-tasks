// The assistant in the team chat, and two things the chat got wrong before it:
// action icons that never rendered (nobody asked lucide after a render) and
// links painted in the same gold as the bubble behind them.
const fs = require('fs'), path = require('path'), http = require('http');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── The grammar ───────────────────────────────────────────────────────────────
const CA = require(process.cwd() + '/src/lib/chat-ai.js');
check('@AI, @assistant and @المساعد are mentions; an email or another name is not',
  CA.mentionsAssistant('@AI what is owed') && CA.mentionsAssistant('hey @assistant?') && CA.mentionsAssistant('(@bot) hi') && CA.mentionsAssistant('@المساعد كم المتبقي')
  && !CA.mentionsAssistant('write to x@ai.com') && !CA.mentionsAssistant('@aisha hello') && !CA.mentionsAssistant('no mention here'));
check('the address is stripped from the question', CA.stripMention('@AI  what does Ahmed owe?') === 'what does Ahmed owe?' && CA.stripMention('hey @assistant, summarise') === 'hey, summarise' && CA.stripMention('@AI') === '');
check('the transcript reads oldest first, names the assistant, and shows files', CA.transcriptOf([{ sender_name: 'Sara', body: 'hi', created_at: '2026-09-30T10:00:00Z' }, { sender_key: 'assistant', body: 'hello', created_at: '2026-09-30T10:01:00Z' }, { sender_name: 'Ali', file_name: 'a.pdf', created_at: '2026-09-30T10:02:00Z' }]) === '10:00 Sara: hi\n10:01 AI Assistant: hello\n10:02 Ali: 📎 a.pdf');
check('the sender has a key, a name and a brain for an avatar', CA.ASSISTANT_KEY === 'assistant' && CA.ASSISTANT_NAME === 'AI Assistant' && /^data:image\/svg\+xml/.test(CA.ASSISTANT_AVATAR));
check('the send handler wakes the assistant on a mention, after the message is out', /res\.json\(msg\);\s*\n\s*\/\/[^\n]*\n\s*if \(chatAi\.mentionsAssistant\(msg\.body\)/.test(fs.readFileSync('src/routes/notifications.js', 'utf8')));
const ASSIST = fs.readFileSync('src/routes/assistant.js', 'utf8');
check('the reply is posted as the assistant, replying to the mention, to every member', /sender_key: chatAi\.ASSISTANT_KEY, sender_name: chatAi\.ASSISTANT_NAME/.test(ASSIST) && /reply_to_id: message\.id/.test(ASSIST) && /chatBroadcast\(keys, 'message'/.test(ASSIST));
check('…with the asker\'s own permissions, never proposing actions', /toolsFor\('home', false, emp\)/.test(ASSIST) && /empCan\(emp, 'assistant', 'chat'\)/.test(ASSIST));

// ── The page, in both portals ─────────────────────────────────────────────────
const ROOMS = [{ id: 1, type: 'group', name: 'Sales & Operations', icon: '', archived: false,
  members: [{ member_key: 'admin', member_name: 'Admin' }, { member_key: 'employee_2', member_name: 'Sara' }, { member_key: 'employee_3', member_name: 'Ali' }], lastMessage: { body: 'x', created_at: '2026-09-30T08:00:00Z' } }];
const MESSAGES = (mine) => [
  { id: 11, room_id: 1, sender_key: 'employee_3', sender_name: 'Ali', body: 'see https://example.com/deal-sheet please', created_at: '2026-09-30T08:00:00Z' },
  { id: 12, room_id: 1, sender_key: mine, sender_name: 'Me', body: 'https://example.com/mine', created_at: '2026-09-30T08:01:00Z' },
  { id: 13, room_id: 1, sender_key: 'employee_3', sender_name: 'Ali', body: '@AI what does Ahmed still owe?', created_at: '2026-09-30T08:02:00Z' },
  { id: 14, room_id: 1, sender_key: 'assistant', sender_name: 'AI Assistant', sender_avatar: CA.ASSISTANT_AVATAR, body: 'Ahmed still owes EGP 700,000 on the Seal.\n- paid 300,000 on 5 Sep', reply_to_id: 13, reply_to_sender: 'Ali', reply_to_body: '@AI what does Ahmed still owe?', created_at: '2026-09-30T08:02:30Z' },
];
function api(pathname, mine) {
  if (/\/chat\/rooms\/1\/messages$/.test(pathname)) return MESSAGES(mine);
  if (/chat\/rooms$/.test(pathname)) return ROOMS;
  if (/huddle\/live$/.test(pathname)) return [];
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', username: 'sara', permissions: { chat: true, chatActions: { view: true, send: true, upload: true, huddle: true } } };
  return [];
}
async function openPortal(browser, { route, file, tokenKey, port, mine }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, mine)) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  // A lucide that counts how often it is asked, in place of the CDN one.
  await page.evaluateOnNewDocument(k => { localStorage.setItem(k, 't'); window.__icons = 0; window.lucide = { createIcons() { window.__icons++; } }; }, tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(600);
  return { page, errs };
}

(async () => {
  const puppeteer = require('puppeteer');
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });
  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', mine: 'admin', list: '#admin-chat-messages', input: '#admin-chat-input', open: 'adminChatOpenRoom', append: 'adminChatAppendMessage' },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', mine: 'employee_2', list: '#chat-messages', input: '#chat-input', open: 'chatOpenRoom', append: 'chatAppendMessage' },
  ]) {
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(() => navigate('chat'));
    await sleep(600);
    const before = await page.evaluate(() => window.__icons);
    await page.evaluate(fn => window[fn](1), portal.open);
    await sleep(800);
    const r = await page.evaluate((sel, before) => {
      const list = document.querySelector(sel);
      const msgs = [...list.querySelectorAll('.chat-msg')];
      const cs = el => getComputedStyle(el);
      const theirs = list.querySelector('.chat-msg[data-msg-id="11"]'), mine = list.querySelector('.chat-msg[data-msg-id="12"]');
      const tl = theirs && theirs.querySelector('.chat-link'), ml = mine && mine.querySelector('.chat-link');
      const tb = theirs && theirs.querySelector('.chat-msg-bubble'), mb = mine && mine.querySelector('.chat-msg-bubble');
      const asst = list.querySelector('.chat-msg[data-msg-id="14"]');
      return {
        count: msgs.length, iconsAfter: window.__icons, before,
        actionIcons: list.querySelectorAll('.chat-action-btn i[data-lucide]').length, actionBtns: list.querySelectorAll('.chat-action-btn').length,
        theirsLink: tl ? cs(tl).color : null, theirsBg: tb ? cs(tb).backgroundColor : null, theirsText: tb ? cs(tb).color : null, theirsLinkOnly: tl ? tl.textContent : '',
        theirsBubbleText: tb ? tb.textContent : '',
        mineLink: ml ? cs(ml).color : null, mineBg: mb ? cs(mb).backgroundColor : null, mineText: mb ? cs(mb).color : null, mineBgImage: mb ? cs(mb).backgroundImage : null,
        mention: (list.querySelector('.chat-msg[data-msg-id="13"] .chat-mention') || {}).textContent || '',
        assistant: !!(asst && asst.classList.contains('assistant')), assistantSender: asst ? (asst.querySelector('.chat-msg-sender') || {}).textContent || '' : '',
        assistantAvatar: !!(asst && asst.querySelector('img.chat-msg-avatar')), assistantQuote: asst ? (asst.querySelector('.chat-reply-quote-body') || {}).textContent || '' : '',
        assistantWrap: asst ? cs(asst.querySelector('.chat-msg-bubble')).whiteSpace : '', assistantBorder: asst ? cs(asst.querySelector('.chat-msg-bubble')).borderTopColor : '',
      };
    }, portal.list, before);
    check(`${portal.label}: the room renders and every message carries reply and forward icons`, r.count === 4 && r.actionBtns >= 8 && r.actionIcons >= 8, JSON.stringify({ count: r.count, btns: r.actionBtns, icons: r.actionIcons }));
    check(`${portal.label}: lucide is asked to draw them after the render`, r.iconsAfter > r.before, `${r.before} → ${r.iconsAfter}`);
    check(`${portal.label}: a link in their bubble stands out from the bubble and is not gold`, r.theirsLink && r.theirsLink !== r.theirsBg && r.theirsLink !== 'rgb(201, 163, 94)' && r.theirsLinkOnly === 'https://example.com/deal-sheet' && /see .* please/.test(r.theirsBubbleText), JSON.stringify({ link: r.theirsLink, bg: r.theirsBg }));
    check(`${portal.label}: a link in my bubble reads in the bubble's own text colour, not the bubble's gold`, r.mineLink && r.mineLink === r.mineText && r.mineLink !== 'rgb(201, 163, 94)', JSON.stringify({ link: r.mineLink, text: r.mineText, bg: r.mineBg }));
    check(`${portal.label}: @AI is highlighted in the message`, r.mention === '@AI', r.mention);
    check(`${portal.label}: the assistant's reply has its own look, name, avatar and quotes the question`, r.assistant && /AI Assistant/.test(r.assistantSender) && r.assistantAvatar && /Ahmed still owe/.test(r.assistantQuote) && r.assistantWrap === 'pre-wrap' && r.assistantBorder !== 'rgba(0, 0, 0, 0)', JSON.stringify({ sender: r.assistantSender, wrap: r.assistantWrap, border: r.assistantBorder }));

    const appended = await page.evaluate((fn, mine) => { const b = window.__icons; window[fn]({ id: 15, room_id: 1, sender_key: 'employee_3', sender_name: 'Ali', body: 'thanks', created_at: '2026-09-30T08:03:00Z' }); return { grew: window.__icons > b, icons: document.querySelectorAll('.chat-msg[data-msg-id="15"] .chat-action-btn i[data-lucide]').length }; }, portal.append, portal.mine);
    check(`${portal.label}: a live-appended message gets its icons too`, appended.grew && appended.icons >= 2, JSON.stringify(appended));

    // Typing "@a" offers the assistant; Tab takes it.
    const hint = await page.evaluate(async (sel) => {
      const el = document.querySelector(sel);
      el.focus(); el.value = 'hey @a'; el.setSelectionRange(6, 6);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      const box = document.getElementById('chat-mention-box');
      return { shown: !!box, text: box ? box.textContent.replace(/\s+/g, ' ').trim() : '' };
    }, portal.input);
    await page.keyboard.press('Tab');
    await sleep(100);
    const picked = await page.evaluate(sel => ({ value: document.querySelector(sel).value, box: !!document.getElementById('chat-mention-box') }), portal.input);
    check(`${portal.label}: typing @ offers the assistant and Tab writes @AI into the message`, hint.shown && /AI Assistant/.test(hint.text) && picked.value === 'hey @AI ' && !picked.box, JSON.stringify({ hint, picked }));
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  await browser.close();
  srv.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
