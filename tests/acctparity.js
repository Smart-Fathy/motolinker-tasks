// The new app's team account menu and its dialogs against the classic team portal's, value by value — the same method as
// tests/secparity.js (see there): the classic page and the new app opened as the same person, in both colour modes and two
// looks, at a phone's width, two in-betweens and a desktop, and the computed style of every named part compared, and the words
// in them. (The administrator has no account menu: its Security is in the footer, and is tests/secparity.js's.)
//
//   button        the person's face in the top bar: initials, and — with a picture — the picture
//   menu          the menu open: picture, name and its pencil, job, status line, and what may be done
//   menuSet       …with a picture and a status
//   status        the status dialog (empty), and with a status already set
//   username      the username dialog, and what it says when the name is taken
//   password      the password dialog, what it says when nothing was typed, and when it worked
//
// What the classic menu does not have — the way back to the classic portal — is not a part to hold to it; it is not read, and
// Sign out, which it moves, is held by what it looks like, not where it is. Run with --print to see every difference rather
// than the first few; --only=<look>/<mode> narrows it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {
  'menu._h': 'the new menu also has the way back to the classic portal, which the classic menu does not (and cannot: it is the classic portal)',
  'menu.bottom': 'the same: the new menu is one row taller',
  'actions._h': 'the same: its list of things to do has one more in it',
  ...Object.fromEntries(['stCard', 'unCard', 'pwCard'].flatMap(k => ['overflowX', 'overflowY', 'maxHeight'].map(p => [`${k}.${p}`,
    'a dialog taller than the window scrolls inside itself in the new app; the classic one is cut off at the top and bottom of the screen'])))
};

// A picture the page can draw without asking the network: a round-able square of one colour
const FACE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3b82f6"/></svg>');

const free = (c, x, text = false) => part(c, x, 'abs', null, text);
const none = (c, x, text = false) => part(c, x, 'none', null, text);
const D_ = '[data-part=dialog]';
const M = '#profile-menu';
const NM = '[data-part=profileMenu]';
const ROLES = (() => {
  const button = {
    profileBtn: free('#profile-btn', '[data-part=profileBtn]'),
    avatar: free('#profile-btn .user-avatar', '[data-part=profileBtn] [data-part=avatar]', true),
    avatarImg: free('#profile-btn .user-avatar img', '[data-part=profileBtn] [data-part=avatar] img'),
  };
  const menu = {
    menu: free(M, NM),
    head: free(`${M} .profile-head`, `${NM} > div:nth-child(1)`),
    changePicture: free(`${M} .profile-av`, '[data-part=changePicture]'),
    avatarLarge: free(`${M} .profile-av .user-avatar`, '[data-part=avatarLarge]', true),
    avatarLargeImg: free(`${M} .profile-av .user-avatar img`, '[data-part=avatarLarge] img'),
    camera: free(`${M} .profile-av-edit`, '[data-part=changePicture] > span:nth-child(2)'),
    cameraIcon: free(`${M} .profile-av-edit svg`, '[data-part=changePicture] > span:nth-child(2) svg'),
    who: free(`${M} .profile-head > div:nth-child(2)`, `${NM} > div:nth-child(1) > div:nth-child(2)`),
    name: free('#user-name', '[data-part=name]', true),
    pencil: free(`${M} .profile-pencil`, '[data-part=changeUsername]'),
    pencilIcon: free(`${M} .profile-pencil svg`, '[data-part=changeUsername] svg'),
    role: free('#user-role', '[data-part=name] + div', true),
    status: free('#user-status', '[data-part=status]', true),
    actions: free(`${M} .profile-actions`, `${NM} > div:nth-child(2)`),
    report: free(`${M} .profile-actions > .profile-item:nth-child(1)`, `${NM} [data-part=reportIssue]`, true),
    reportIcon: free(`${M} .profile-actions > .profile-item:nth-child(1) svg`, `${NM} [data-part=reportIssue] svg`),
    changePassword: free(`${M} .profile-actions > .profile-item:nth-child(2)`, `${NM} [data-part=changePassword]`, true),
    changePasswordIcon: free(`${M} .profile-actions > .profile-item:nth-child(2) svg`, `${NM} [data-part=changePassword] svg`),
    security: free(`${M} .profile-actions > .profile-item:nth-child(3)`, `${NM} [data-part=security]`, true),
    securityIcon: free(`${M} .profile-actions > .profile-item:nth-child(3) svg`, `${NM} [data-part=security] svg`),
    // (the classic menu has no way back to itself; Sign out is last in both, one place further down in the new app)
    signOut: none(`${M} .profile-actions > .profile-item.danger`, `${NM} > div:nth-child(2) > button:last-child`, true),
  };
  const dialog = (card, newCard) => ({
    curtain: free(card.replace(/ > div$/, ''), '[data-part=curtain]'),
    card: free(card, newCard),
  });
  // Set status
  const S = '#status-modal > div';
  const status = {
    ...Object.fromEntries(Object.entries(dialog(S, '[data-part=dialog]')).map(([k, v]) => ['st' + k[0].toUpperCase() + k.slice(1), v])),
    stHead: free(`${S} > div:nth-child(1)`, `${D_} > [data-part=head]`),
    stTitle: free(`${S} > div:nth-child(1) > div`, `${D_} [data-part=title]`, true),
    stClose: free(`${S} > div:nth-child(1) > button`, `${D_} [data-part=close]`, true),
    stRow: free(`${S} > div:nth-child(2)`, '[data-part=body] > div:nth-child(1)'),
    stEmoji: free('#st-emoji', '[data-part=emoji]'),
    stText: free('#st-text', '[data-part=text]'),
    stLabel: free(`${S} > div:nth-child(3)`, '[data-part=body] > div:nth-child(2)', true),
    stPresets: free(`${S} > div:nth-child(4)`, '[data-part=presets]'),
    stPreset1: free(`${S} > div:nth-child(4) > button:nth-child(1)`, '[data-part=preset]:nth-child(1)', true),
    stPreset3: free(`${S} > div:nth-child(4) > button:nth-child(3)`, '[data-part=preset]:nth-child(3)', true),
    stNote3: free(`${S} > div:nth-child(4) > button:nth-child(3) span`, '[data-part=preset]:nth-child(3) span', true),
    stFoot: free(`${S} > div:nth-child(5)`, '[data-part=body] > div:nth-child(4)'),
    stClear: free(`${S} > div:nth-child(5) > button:nth-child(1)`, '[data-part=clear]', true),
    stSave: free(`${S} > div:nth-child(5) > button:nth-child(2)`, '[data-part=save]', true),
  };
  // Change Username
  const U = '#username-modal > div';
  const username = {
    unCard: free(U, '[data-part=dialog]'),
    unTitle: free(`${U} > div:nth-child(1)`, `${D_} [data-part=title]`, true),
    unHint: free(`${U} > div:nth-child(2)`, `${D_} [data-part=hint]`, true),
    unInput: free('#un-input', '[data-part=username]'),
    unFoot: free(`${U} > div:nth-child(5)`, '[data-part=body] > div:last-child'),
    unCancel: free(`${U} > div:nth-child(5) > button:nth-child(1)`, '[data-part=cancel]', true),
    unSave: free(`${U} > div:nth-child(5) > button:nth-child(2)`, '[data-part=save]', true),
  };
  const usernameError = { unErr: free('#un-err', '[data-part=error]', true) };
  // Change Password
  const P = '#change-pass-modal > div';
  const password = {
    pwCard: free(P, '[data-part=dialog]'),
    pwTitle: free(`${P} > div:nth-child(1)`, `${D_} [data-part=title]`, true),
    pwHint: free(`${P} > div:nth-child(2)`, `${D_} [data-part=hint]`, true),
    pwGroup1: free('#change-pass-modal .form-group:has(> #chpass-current)', '[data-part=group]:has(> [data-part=current])'),
    pwLabel1: free('#change-pass-modal .form-group:has(> #chpass-current) label', '[data-part=group]:has(> [data-part=current]) label', true),
    pwCurrent: free('#chpass-current', '[data-part=current]'),
    pwNew: free('#chpass-new', '[data-part=new]'),
    pwConfirm: free('#chpass-confirm', '[data-part=confirm]'),
    pwFoot: free(`${P} > div:last-child`, '[data-part=body] > div:last-child'),
    pwCancel: free('#change-pass-modal .btn-outline', '[data-part=cancel]', true),
    pwUpdate: free('#chpass-btn', '[data-part=update]', true),
  };
  const passwordError = { pwErr: free('#chpass-err', '[data-part=error]', true) };
  const passwordOk = { pwOk: free('#chpass-ok', '[data-part=done]', true) };
  return { button, menu, status, username, usernameError, password, passwordError, passwordOk };
})();

const READS = {
  button: ['button'],
  menu: ['button', 'menu'],
  menuSet: ['button', 'menu'],
  status: ['status'],
  statusSet: ['status'],
  username: ['username'],
  usernameError: ['username', 'usernameError'],
  password: ['password'],
  passwordError: ['password', 'passwordError'],
  passwordOk: ['password', 'passwordOk'],
};
// (the picture is only there where one was set)
const WITH_PICTURE = new Set(['menuSet']);

const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 3975 });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const team = portals.find(p => p.who === 'team');
  const adminToken = portals.find(p => p.who === 'admin').token;
  db.tables.employees.push({ ...db.tables.employees[0], id: 2, name: 'Omar Hassan', username: 'omar', permissions: {} });
  const browser = await launch();
  const observed = {};

  const scenario = async (mode, side, key) => {
    const next = side === 'next';
    const person = db.tables.employees[0];
    // Who the page is about: no picture, no status (the menu is the same whatever the password is, but the dialog needs a real one)
    Object.assign(person, { avatar_url: '', status_emoji: '', status_text: '', username: 'smoke', password_hash: ctx.hashPassword('old-password-1') });
    ctx.employeeSessions.set('other-device', { id: 1, name: 'Admin Person', username: 'smoke', job_title: 'Chief Technical Officer', permissions: {}, createdAt: Date.now() });
    const page = await openPage(browser, base, team, mode, next);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + '.ai-card,[data-part=aiCard]{display:none!important}' });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(e => { throw new Error(`${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]}`); });
    const reading = async (state, groups, extra = {}) => {
      const which = {};
      for (const g of groups) Object.assign(which, ROLES[g]);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 900 });
        await settle(page);
        const at = `${key}/${state}/${width}`;
        (observed[at] = observed[at] || {})[side] = await readRoles(page, which, side, PROPS_MORE);
      }
      await page.setViewport({ width: 1100, height: 900 });
      await settle(page);
      void extra;
    };
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    // (a classic dialog is there when its curtain is shown: its card is `display:block` inside a curtain that is not)
    const present = (classic, now, what) => until(s => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, pick(classic, now), what);
    const gone = (classic, now, what) => until(s => !document.querySelector(s) || !document.querySelector(s).checkVisibility(), pick(classic, now), what);
    const menu = async () => { await click('#profile-btn', '[data-part=profileBtn]'); await present(M, NM, 'the menu'); };

    // the button, then the menu
    await reading('button', READS.button);
    await menu();
    await reading('menu', READS.menu);

    // the status dialog, empty
    await click(`${M} .profile-status`, '[data-part=status]');
    await present('#status-modal > div', '[data-part=dialog]', 'the status dialog');
    await reading('status', READS.status);
    await click('#status-modal button[onclick*="display=\'none\'"]', '[data-part=dialog] [data-part=close]');
    await gone('#status-modal > div', '[data-part=dialog]', 'the status dialog to close');

    // the username dialog, and a name that is taken
    await menu();
    await click(`${M} .profile-pencil`, '[data-part=changeUsername]');
    await present('#username-modal > div', '[data-part=dialog]', 'the username dialog');
    await reading('username', READS.username);
    await page.$eval(pick('#un-input', '[data-part=username]'), e => { e.value = ''; });
    await page.type(pick('#un-input', '[data-part=username]'), 'omar');
    await click('#username-modal .btn-primary', '[data-part=dialog] [data-part=save]');
    await until(s => { const e = document.querySelector(s); return !!e && e.textContent.trim().length > 0 && getComputedStyle(e).display !== 'none'; }, pick('#un-err', '[data-part=error]'), 'the error');
    await reading('usernameError', READS.usernameError);
    await click('#username-modal .btn-outline', '[data-part=dialog] [data-part=cancel]');
    await gone('#username-modal > div', '[data-part=dialog]', 'the username dialog to close');

    // the password dialog: nothing typed, then the right answers
    await menu();
    await page.evaluate(next => [...document.querySelectorAll(next ? '[data-part=profileMenu] button' : '#profile-menu .profile-item')].find(b => b.textContent.trim() === 'Change password').click(), next);
    await present('#change-pass-modal > div', '[data-part=dialog]', 'the password dialog');
    await reading('password', READS.password);
    await click('#chpass-btn', '[data-part=update]');
    await until(s => { const e = document.querySelector(s); return !!e && e.textContent.trim().length > 0 && getComputedStyle(e).display !== 'none'; }, pick('#chpass-err', '[data-part=error]'), 'the error');
    await reading('passwordError', READS.passwordError);
    await page.type(pick('#chpass-current', '[data-part=current]'), 'old-password-1');
    await page.type(pick('#chpass-new', '[data-part=new]'), 'new-password-9');
    await page.type(pick('#chpass-confirm', '[data-part=confirm]'), 'new-password-9');
    await click('#chpass-btn', '[data-part=update]');
    await until(s => { const e = document.querySelector(s); return !!e && /Password updated/.test(e.textContent) && getComputedStyle(e).display !== 'none'; }, pick('#chpass-ok', '[data-part=done]'), 'the success');
    await until(s => !document.querySelector(s).disabled, pick('#chpass-btn', '[data-part=update]'), 'the button to come back');
    await reading('passwordOk', READS.passwordOk);
    await click('#change-pass-modal .btn-outline', '[data-part=dialog] [data-part=cancel]');
    await gone('#change-pass-modal > div', '[data-part=dialog]', 'the password dialog to close');
    await page.shut();

    // with a picture and a status: a person who has made themselves at home
    Object.assign(person, { avatar_url: FACE, status_emoji: '📚', status_text: 'Focusing' });
    const page2 = await openPage(browser, base, team, mode, next);
    await page2.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page2.addStyleTag({ content: STILL + '.ai-card,[data-part=aiCard]{display:none!important}' });
    const wait2 = (fn, arg, what) => page2.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(e => { throw new Error(`${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]}`); });
    await wait2(s => { const i = document.querySelector(s); return !!i && i.complete && i.naturalWidth > 0; }, pick('#profile-btn .user-avatar img', '[data-part=profileBtn] [data-part=avatar] img'), 'the picture');
    await page2.evaluate(s => document.querySelector(s).click(), pick('#profile-btn', '[data-part=profileBtn]'));
    await wait2(s => !!document.querySelector(s) && getComputedStyle(document.querySelector(s)).display !== 'none', pick(M, NM), 'the menu');
    const which = Object.assign({}, ROLES.button, ROLES.menu);
    for (const width of WIDTHS) {
      await page2.setViewport({ width, height: 900 });
      await settle(page2);
      const at = `${key}/menuSet/${width}`;
      (observed[at] = observed[at] || {})[side] = await readRoles(page2, which, side, PROPS_MORE);
    }
    await page2.setViewport({ width: 1100, height: 900 });
    await page2.evaluate(s => document.querySelector(s).click(), pick(`${M} .profile-status`, '[data-part=status]'));
    await wait2(s => !!document.querySelector(s) && getComputedStyle(document.querySelector(s)).display !== 'none', pick('#status-modal > div', '[data-part=dialog]'), 'the status dialog');
    const whichStatus = Object.assign({}, ROLES.status);
    for (const width of WIDTHS) {
      await page2.setViewport({ width, height: 900 });
      await settle(page2);
      const at = `${key}/statusSet/${width}`;
      (observed[at] = observed[at] || {})[side] = await readRoles(page2, whichStatus, side, PROPS_MORE);
    }
    await page2.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${look}/${mode}`.startsWith(ONLY)) continue;
      await scenario(mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();
  void WITH_PICTURE;

  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const { n, bad } = diff(classic, next, ACCEPTED, stale, PROPS_MORE);
    compared += n;
    check(`${key}: ${n} values are the classic menu's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!ONLY) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 100000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
