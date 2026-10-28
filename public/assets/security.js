// The Security panel — shared by the team portal and the admin dashboard.
//
// Two-factor authentication, the devices an account is signed in on, and its recent
// sign-ins. One file for both portals so they cannot disagree about what a "device" is,
// how recovery codes are shown, or what turning a thing off asks for. Each portal hands
// it its own authenticated fetch and where its API lives:
//
//   SecurityPanel.open({ call, base, kind, changePassword, afterSignOut })
//     call(path, opts)   the portal's fetch, session token already on it
//     base               '/api/employee' | '/api/dashboard'
//     kind               'employee' | 'admin'
//     changePassword     optional; adds a button that opens the portal's own dialog
//     afterSignOut       optional; runs after other devices are signed out (the server
//                        clears push subscriptions with the sessions, so the portal
//                        re-registers this device's)
(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let cfg = null;      // what the portal gave us
  let data = null;     // the last /security answer
  let view = 'main';   // main | setup-password | setup-scan | codes | disable | newcodes
  let draft = {};      // the setup in progress and the codes just issued
  let busy = false;

  const CSS = `
  #sec-overlay{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:10000;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;-webkit-overflow-scrolling:touch}
  #sec-overlay.open{display:flex}
  .sec-box{background:var(--surface,#141416);border:1px solid var(--border,rgba(255,255,255,.09));border-radius:calc(16px * var(--r-k,1));width:100%;max-width:580px;padding:22px 22px 18px;color:var(--text,#f3efe7);box-shadow:0 20px 60px rgba(0,0,0,.5);margin:auto 0}
  .sec-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:4px}
  .sec-title{font-size:17px;font-weight:700}
  .sec-lead{font-size:12px;color:var(--muted,#8d897f);margin:0 0 16px}
  .sec-x{background:none;border:none;color:var(--muted,#8d897f);font-size:24px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:calc(6px * var(--r-k,1))}
  .sec-x:hover{color:var(--text,#f3efe7)}
  .sec-card{border:1px solid var(--border,rgba(255,255,255,.09));border-radius:calc(12px * var(--r-k,1));padding:14px 16px;margin-bottom:14px}
  .sec-h{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .sec-sub{font-size:12px;color:var(--muted,#8d897f);margin-top:4px;line-height:1.5}
  .sec-row{display:flex;align-items:center;justify-content:space-between;gap:14px}
  .sec-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .sec-pill{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:99px}
  .sec-pill.on{background:rgba(138,154,134,.18);color:var(--success,#8a9a86)}
  .sec-pill.off{background:rgba(201,125,110,.14);color:var(--danger,#c97d6e)}
  .sec-pill.new{background:rgba(var(--primary-rgb,201,163,94),.16);color:var(--warning,#c9a35e)}
  .sec-pill.here{background:rgba(138,154,134,.18);color:var(--success,#8a9a86)}
  .sec-list{display:flex;flex-direction:column}
  .sec-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--border,rgba(255,255,255,.09))}
  .sec-item:first-child{border-top:none;padding-top:2px}
  .sec-item b{font-size:13px;font-weight:600}
  .sec-meta{font-size:11.5px;color:var(--muted,#8d897f);margin-top:2px;line-height:1.45}
  .sec-input{width:100%;box-sizing:border-box;background:var(--bg,#0c0c0e);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--text,#f3efe7);border-radius:calc(9px * var(--r-k,1));padding:11px 12px;font-size:14px;font-family:inherit;margin-top:6px}
  .sec-input:focus{outline:none;border-color:var(--primary,#c9a35e)}
  .sec-label{font-size:12px;font-weight:600;margin-top:12px;display:block}
  .sec-btn{border:1px solid var(--border,rgba(255,255,255,.14));background:transparent;color:var(--text,#f3efe7);border-radius:calc(9px * var(--r-k,1));padding:8px 14px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
  .sec-btn:hover{border-color:var(--primary,#c9a35e)}
  .sec-btn:disabled{opacity:.5;cursor:default}
  .sec-btn.primary{background:var(--primary,#c9a35e);border-color:var(--primary,#c9a35e);color:#17130a}
  .sec-btn.danger{color:var(--danger,#c97d6e);border-color:rgba(201,125,110,.4)}
  .sec-btn.sm{padding:5px 10px;font-size:11.5px}
  .sec-msg{display:none;padding:10px 14px;border-radius:calc(9px * var(--r-k,1));font-size:12.5px;margin-bottom:12px;line-height:1.45}
  .sec-msg.err{display:block;background:rgba(201,125,110,.1);border:1px solid rgba(201,125,110,.3);color:var(--danger,#c97d6e)}
  .sec-msg.ok{display:block;background:rgba(138,154,134,.1);border:1px solid rgba(138,154,134,.3);color:var(--success,#8a9a86)}
  .sec-qr{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:10px 0 4px}
  .sec-qr img{width:176px;height:176px;border-radius:calc(10px * var(--r-k,1));background:#fff;padding:6px;box-sizing:border-box}
  .sec-key{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;letter-spacing:.06em;word-break:break-all;background:var(--bg,#0c0c0e);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:calc(8px * var(--r-k,1));padding:8px 10px;margin-top:6px;user-select:all}
  .sec-codes{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0}
  .sec-codes code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;background:var(--bg,#0c0c0e);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:calc(8px * var(--r-k,1));padding:8px 10px;text-align:center;user-select:all}
  .sec-steps{font-size:12.5px;color:var(--muted,#8d897f);line-height:1.6;margin:8px 0 0;padding-left:18px}
  .sec-check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;margin:12px 0;cursor:pointer}
  .sec-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
  @media (max-width:560px){.sec-box{padding:16px 14px}.sec-row{flex-direction:column;align-items:stretch}.sec-actions{justify-content:flex-start}.sec-item{align-items:flex-start;flex-direction:column;gap:6px}.sec-qr{justify-content:center}}
  `;

  function shell() {
    let ov = document.getElementById('sec-overlay');
    if (ov) return ov;
    const st = document.createElement('style'); st.id = 'sec-style'; st.textContent = CSS; document.head.appendChild(st);
    ov = document.createElement('div');
    ov.id = 'sec-overlay';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Account security');
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
    document.body.appendChild(ov);
    return ov;
  }

  // ── Small helpers ──────────────────────────────────────────────────────────
  function ago(ms) {
    if (!ms) return 'unknown';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 90) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24); return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  }
  function stamp(v) {
    try { return new Date(v).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  }
  const METHODS = { password: 'Password', google: 'Google', 'password+2fa': 'Password + code', 'google+2fa': 'Google + code', 'password+recovery': 'Password + recovery code', 'google+recovery': 'Google + recovery code' };
  const methodLabel = m => METHODS[m] || (m ? esc(m) : '');
  const groups4 = k => String(k || '').replace(/(.{4})/g, '$1 ').trim();

  async function api(method, path, body) {
    const r = await cfg.call(cfg.base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = {}; try { d = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, d };
  }
  function say(kind, text) {
    const el = document.getElementById('sec-msg');
    if (!el) return;
    el.className = 'sec-msg ' + kind; el.textContent = text; el.style.display = text ? 'block' : 'none';
  }
  const val = id => (document.getElementById(id) || {}).value || '';
  // Disable a button and say what it is doing, so a slow answer is not clicked twice.
  function setBusy(on, btnId, label) {
    busy = on;
    const b = btnId && document.getElementById(btnId);
    if (!b) return;
    if (on) { b.dataset.label = b.textContent; if (label) b.textContent = label; b.disabled = true; }
    else { if (b.dataset.label) b.textContent = b.dataset.label; b.disabled = false; }
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  function render() {
    const ov = shell();
    const body = ({
      main: viewMain, 'setup-password': viewSetupPassword, 'setup-scan': viewSetupScan,
      codes: viewCodes, disable: viewDisable, newcodes: viewNewCodes,
    }[view] || viewMain)();
    ov.innerHTML = `<div class="sec-box">
      <div class="sec-head"><div class="sec-title">Account security</div><button class="sec-x" aria-label="Close" onclick="SecurityPanel.close()">&times;</button></div>
      <p class="sec-lead">${esc(data && data.account && data.account.name ? data.account.name + ' · ' : '')}Protect your account and see where it is signed in.</p>
      <div id="sec-msg" class="sec-msg"></div>
      ${body}
    </div>`;
    const first = ov.querySelector('input'); if (first) first.focus();
  }

  function viewMain() {
    if (!data) return '<div class="sec-sub">Loading…</div>';
    const t = data.twofa || {};
    let twofa;
    if (!t.available) {
      twofa = `<div class="sec-h">Two-factor authentication <span class="sec-pill off">Unavailable</span></div>
        <div class="sec-sub">${t.reason === 'error'
          ? 'Could not load this right now. Close the panel and try again in a moment.'
          : 'This needs a database update that has not been applied yet. Ask whoever runs the system to apply migration <code>023_account_security.sql</code>, then reopen this panel.'}</div>`;
    } else if (t.enabled) {
      twofa = `<div class="sec-row"><div>
          <div class="sec-h">Two-factor authentication <span class="sec-pill on">On</span></div>
          <div class="sec-sub">Signing in needs a 6-digit code from your authenticator app${t.enabledAt ? ` · turned on ${esc(stamp(t.enabledAt))}` : ''}.<br>
            ${t.recoveryLeft} recovery code${t.recoveryLeft === 1 ? '' : 's'} left${t.recoveryLeft <= 2 ? ' — <b>make new ones soon</b>' : ''}.</div>
        </div><div class="sec-actions">
          <button class="sec-btn sm" onclick="SecurityPanel.go('newcodes')">New recovery codes</button>
          <button class="sec-btn sm danger" onclick="SecurityPanel.go('disable')">Turn off</button>
        </div></div>`;
    } else {
      twofa = `<div class="sec-row"><div>
          <div class="sec-h">Two-factor authentication <span class="sec-pill off">Off</span></div>
          <div class="sec-sub">Add a second step to signing in: a 6-digit code from an authenticator app on your phone. Even if your password leaks, nobody gets in without your phone.</div>
        </div><div class="sec-actions"><button class="sec-btn primary" onclick="SecurityPanel.go('setup-password')">Turn on</button></div></div>`;
    }
    if (t.available && data.account && data.account.kind === 'admin' && t.encrypted === false) {
      twofa += `<div class="sec-sub" style="margin-top:8px">Two-factor secrets are stored unencrypted until <code>MFA_ENCRYPTION_KEY</code> is set on the server.</div>`;
    }

    const sessions = (data.sessions || []).map(s => `<div class="sec-item"><div>
        <b>${esc(s.device)}</b> ${s.current ? '<span class="sec-pill here">This device</span>' : ''}
        <div class="sec-meta">${esc(s.ip || 'unknown address')} · signed in ${esc(ago(s.createdAt))} · last active ${esc(ago(s.lastSeenAt))}${s.method ? ' · ' + methodLabel(s.method) : ''}</div>
      </div>${s.current ? '' : `<button class="sec-btn sm danger" data-sid="${esc(s.sid)}" onclick="SecurityPanel.signOut(this.dataset.sid)">Sign out</button>`}</div>`).join('');
    const others = (data.sessions || []).filter(s => !s.current).length;

    const logins = data.history === false
      ? '<div class="sec-sub">The sign-in history needs the same database update (migration 023).</div>'
      : (data.logins || []).length
        ? (data.logins || []).map(l => `<div class="sec-item"><div>
            <b>${esc(l.device || 'Unknown device')}</b> ${l.new_device ? '<span class="sec-pill new">New device</span>' : ''}
            <div class="sec-meta">${esc(l.ip || 'unknown address')} · ${methodLabel(l.method)}</div></div>
            <div class="sec-meta" style="margin:0;white-space:nowrap">${esc(stamp(l.at))}</div></div>`).join('')
        : '<div class="sec-sub">Nothing recorded yet.</div>';

    return `
      <div class="sec-card">${twofa}</div>
      <div class="sec-card">
        <div class="sec-row"><div><div class="sec-h">Where you're signed in</div>
          <div class="sec-sub">If you don't recognise one, sign it out and change your password.</div></div>
          ${others ? `<div class="sec-actions"><button class="sec-btn sm danger" onclick="SecurityPanel.signOutOthers()">Sign out all other devices</button></div>` : ''}</div>
        <div class="sec-list" style="margin-top:8px">${sessions || '<div class="sec-sub">No sessions.</div>'}</div>
      </div>
      <div class="sec-card"><div class="sec-h">Recent sign-ins</div>
        <div class="sec-sub" style="margin-bottom:6px">${data.alerts === 'off' ? 'Alerts are off.' : 'You are alerted when someone signs in from a device you haven\'t used before.'}</div>
        <div class="sec-list">${logins}</div></div>
      ${cfg.changePassword ? `<div class="sec-card"><div class="sec-row"><div><div class="sec-h">Password</div>
          <div class="sec-sub">Changing it signs out every other device.</div></div>
          <div class="sec-actions"><button class="sec-btn sm" onclick="SecurityPanel.changePassword()">Change password</button></div></div></div>` : ''}`;
  }

  const reauthFields = (extra) => `
    <label class="sec-label" for="sec-pw">Your password</label>
    <input class="sec-input" id="sec-pw" type="password" autocomplete="current-password" placeholder="Confirm it's you" onkeydown="if(event.key==='Enter')${extra}">`;

  function viewSetupPassword() {
    return `<div class="sec-card">
      <div class="sec-h">Turn on two-factor authentication</div>
      <div class="sec-sub">You'll need an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). First, confirm your password.</div>
      ${reauthFields('SecurityPanel.startSetup()')}
      <div class="sec-foot"><button class="sec-btn" onclick="SecurityPanel.go('main')">Cancel</button>
        <button class="sec-btn primary" id="sec-go" onclick="SecurityPanel.startSetup()">Continue</button></div></div>`;
  }

  function viewSetupScan() {
    const s = draft.setup || {};
    return `<div class="sec-card">
      <div class="sec-h">Scan this with your authenticator app</div>
      <ol class="sec-steps"><li>Open the app and add an account (＋), then scan the code below.</li>
        <li>Type the 6-digit code it shows to finish.</li></ol>
      <div class="sec-qr"><img alt="QR code to scan with your authenticator app" src="${esc(s.qr)}">
        <div style="flex:1;min-width:190px"><div class="sec-sub">On your phone? <a href="${esc(s.otpauth)}" style="color:var(--primary-text,var(--primary,#c9a35e))">Open in your authenticator app</a>.</div>
          <div class="sec-sub" style="margin-top:10px">Or enter this key by hand:</div><div class="sec-key">${esc(groups4(s.secret))}</div></div></div>
      <label class="sec-label" for="sec-code">6-digit code</label>
      <input class="sec-input" id="sec-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" onkeydown="if(event.key==='Enter')SecurityPanel.finishSetup()">
      <div class="sec-foot"><button class="sec-btn" onclick="SecurityPanel.go('main')">Cancel</button>
        <button class="sec-btn primary" id="sec-go" onclick="SecurityPanel.finishSetup()">Turn on</button></div></div>`;
  }

  function viewCodes() {
    const codes = draft.codes || [];
    return `<div class="sec-card">
      <div class="sec-h">Save your recovery codes</div>
      <div class="sec-sub">If you lose your phone, each of these signs you in <b>once</b>. They are shown only now — store them somewhere safe (a password manager, or printed).</div>
      <div class="sec-codes">${codes.map(c => `<code>${esc(c)}</code>`).join('')}</div>
      <div class="sec-actions" style="justify-content:flex-start"><button class="sec-btn sm" onclick="SecurityPanel.copyCodes()">Copy</button><button class="sec-btn sm" onclick="SecurityPanel.downloadCodes()">Download</button></div>
      ${draft.signedOut ? `<div class="sec-sub" style="margin-top:12px">${draft.signedOut} other device${draft.signedOut === 1 ? ' was' : 's were'} signed out.</div>` : ''}
      <label class="sec-check"><input type="checkbox" id="sec-saved" onchange="document.getElementById('sec-go').disabled=!this.checked"> I have saved these codes</label>
      <div class="sec-foot"><button class="sec-btn primary" id="sec-go" disabled onclick="SecurityPanel.done()">Done</button></div></div>`;
  }

  function viewDisable() {
    return `<div class="sec-card">
      <div class="sec-h">Turn off two-factor authentication</div>
      <div class="sec-sub">Your account will be protected by your password alone, and your other devices will be signed out.</div>
      ${reauthFields('document.getElementById(\'sec-code\').focus()')}
      <label class="sec-label" for="sec-code">Code from your app (or a recovery code)</label>
      <input class="sec-input" id="sec-code" autocomplete="one-time-code" maxlength="14" placeholder="123456" onkeydown="if(event.key==='Enter')SecurityPanel.turnOff()">
      <div class="sec-foot"><button class="sec-btn" onclick="SecurityPanel.go('main')">Cancel</button>
        <button class="sec-btn danger" id="sec-go" onclick="SecurityPanel.turnOff()">Turn off</button></div></div>`;
  }

  function viewNewCodes() {
    return `<div class="sec-card">
      <div class="sec-h">Make new recovery codes</div>
      <div class="sec-sub">The old codes stop working.</div>
      ${reauthFields('document.getElementById(\'sec-code\').focus()')}
      <label class="sec-label" for="sec-code">Code from your app</label>
      <input class="sec-input" id="sec-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" onkeydown="if(event.key==='Enter')SecurityPanel.newCodes()">
      <div class="sec-foot"><button class="sec-btn" onclick="SecurityPanel.go('main')">Cancel</button>
        <button class="sec-btn primary" id="sec-go" onclick="SecurityPanel.newCodes()">Make new codes</button></div></div>`;
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function load() {
    const r = await api('GET', '/security');
    if (r.ok) { data = r.d; }
    else if (r.status !== 401) { say('err', (r.d && r.d.error) || 'Could not load your security settings.'); }
    render();
  }

  async function startSetup() {
    if (busy) return;
    const password = val('sec-pw');
    if (!password) return say('err', 'Enter your password.');
    setBusy(true, 'sec-go', 'Checking…');
    const r = await api('POST', '/security/2fa/setup', { password });
    setBusy(false, 'sec-go');
    if (!r.ok) return say('err', r.d.error || 'Could not start setup.');
    draft = { setup: r.d };
    view = 'setup-scan'; render();
  }

  async function finishSetup() {
    if (busy) return;
    const code = val('sec-code').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return say('err', 'Enter the 6-digit code from your app.');
    setBusy(true, 'sec-go', 'Checking…');
    const r = await api('POST', '/security/2fa/enable', { code });
    setBusy(false, 'sec-go');
    if (!r.ok) return say('err', r.d.error || 'That code did not work.');
    draft = { codes: r.d.recoveryCodes, signedOut: r.d.sessionsRevoked || 0 };
    if (cfg.afterSignOut) cfg.afterSignOut();
    view = 'codes'; render();
  }

  async function turnOff() {
    if (busy) return;
    const password = val('sec-pw'), code = val('sec-code');
    if (!password || !code) return say('err', 'Enter your password and a code.');
    setBusy(true, 'sec-go', 'Turning off…');
    const r = await api('POST', '/security/2fa/disable', { password, code });
    setBusy(false, 'sec-go');
    if (!r.ok) return say('err', r.d.error || 'Could not turn it off.');
    if (cfg.afterSignOut) cfg.afterSignOut();
    view = 'main'; draft = {}; await load();
    say('ok', 'Two-factor authentication is off. Your other devices were signed out.');
  }

  async function newCodes() {
    if (busy) return;
    const password = val('sec-pw'), code = val('sec-code').replace(/\s/g, '');
    if (!password || !/^\d{6}$/.test(code)) return say('err', 'Enter your password and the 6-digit code.');
    setBusy(true, 'sec-go', 'Working…');
    const r = await api('POST', '/security/2fa/recovery-codes', { password, code });
    setBusy(false, 'sec-go');
    if (!r.ok) return say('err', r.d.error || 'Could not make new codes.');
    draft = { codes: r.d.recoveryCodes };
    view = 'codes'; render();
  }

  async function signOut(sid) {
    const r = await api('DELETE', '/security/sessions/' + encodeURIComponent(sid));
    if (!r.ok) say('err', r.d.error || 'Could not sign that device out.');
    await load();
    if (r.ok) say('ok', 'Signed out. If you did not recognise it, also change your password.');
  }

  async function signOutOthers() {
    if (!confirm('Sign out every other device? They will need to sign in again.')) return;
    const r = await api('POST', '/security/sessions/revoke-others', {});
    if (cfg.afterSignOut) cfg.afterSignOut();
    await load();
    if (r.ok) say('ok', r.d.sessionsRevoked ? `Signed out ${r.d.sessionsRevoked} other device${r.d.sessionsRevoked === 1 ? '' : 's'}.` : 'There were no other devices.');
    else say('err', r.d.warning || r.d.error || 'Some devices could not be signed out. Try again.');
  }

  function codesText() {
    return `MotoLinker recovery codes${data && data.account && data.account.name ? ' for ' + data.account.name : ''}\nMade ${new Date().toLocaleString()}\nEach code works once.\n\n${(draft.codes || []).join('\n')}\n`;
  }
  async function copyCodes() {
    try { await navigator.clipboard.writeText(codesText()); say('ok', 'Copied.'); }
    catch (_) {
      const ta = document.createElement('textarea'); ta.value = codesText(); document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); say('ok', 'Copied.'); } catch (e) { say('err', 'Could not copy — select the codes and copy them by hand.'); }
      ta.remove();
    }
  }
  function downloadCodes() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([codesText()], { type: 'text/plain' }));
    a.download = 'motolinker-recovery-codes.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function go(v) { view = v; if (v === 'main') draft = {}; render(); }
  async function done() { draft = {}; view = 'main'; await load(); }
  function close() { const ov = document.getElementById('sec-overlay'); if (ov) ov.classList.remove('open'); draft = {}; view = 'main'; }

  window.SecurityPanel = {
    async open(options) {
      cfg = options; data = null; view = 'main'; draft = {}; busy = false;
      shell().classList.add('open'); render();
      await load();
    },
    close, go, done, startSetup, finishSetup, turnOff, newCodes, signOut, signOutOthers, copyCodes, downloadCodes,
    changePassword() { close(); if (cfg && cfg.changePassword) cfg.changePassword(); },
  };
})();
