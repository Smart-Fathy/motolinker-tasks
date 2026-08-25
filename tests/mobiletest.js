// Every page of both portals, at a real phone viewport.
//
// The audit that prompted this work could not shrink its browser below ~1321px and had
// to emulate a phone by forcing the app's own media queries to apply inside a narrow
// container. Puppeteer can just be a phone, so this is the check that should have
// existed all along: 390x844, isMobile, hasTouch, every page visited, and the layout
// measured rather than reasoned about.
//
// The horizontal-overflow assertion is the important one. A single number per page
// catches the header, the Deals kanban, the quotation grids and Submissions at once —
// and it is impossible to satisfy by accident.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const VIEWPORT = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const TOUCH_MIN = 44;

// Enough of a fixture that lists actually have rows — an empty table cannot overflow.
const LEAD_COUNT = 120;
const LEADS = Array.from({ length: LEAD_COUNT }, (_, i) => ({
  id: i + 1, name: `Lead Person ${i + 1}`, phone: '010012345' + (i % 10),
  lead_status: ['cold', 'warm', 'hot'][i % 3], source: 'fb_ad',
  car_in_question: 'Chery Tiggo 8 Pro Max Luxury', budget_lead: 1500000,
  notes: 'Called twice, asked about financing and delivery timing.',
  lead_date: '2026-08-0' + ((i % 9) + 1), created_at: '2026-08-01T09:00:00Z',
}));
const TASKS = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, title: 'Follow up on the shipment paperwork ' + (i + 1),
  description: 'A description long enough to wrap on a narrow screen.',
  channel_name: 'operations', assignee_ids: [2], status: ['todo', 'in_progress', 'done'][i % 3],
  priority: 'high', due_date: '2026-09-01', created_at: '2026-08-01T09:00:00Z',
}));
const EMPLOYEES = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, name: 'Employee Number ' + (i + 1), username: 'emp' + i,
  job_title: 'Senior Sales Consultant', email: `employee${i}@motolinker.example.com`,
  permissions: { requests: true, drive: true, sheets: true, leads: true, deals: i % 2 === 0 },
  created_at: '2026-08-01T09:00:00Z',
}));
const GENERIC = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1, name: 'Record ' + (i + 1), title: 'A reasonably long record title ' + (i + 1),
  status: 'open', created_at: '2026-08-01T09:00:00Z', created_by: 'admin',
  entity_type: 'lead', entity_label: 'Ahmed Kamal · 01001234567', requested_by: 'sara',
  supplier: 'Abo Hetta Trading', po_number: 'PO26' + i, contract_no: 'C-' + i, rfq_no: 'RFQ-' + i,
  hours: 7.5, log_date: '2026-08-0' + ((i % 9) + 1), employee_id: 2,
  make: 'Chery', model: 'Tiggo 8', quantity: 3, colors: [], units: [],
}));

function api(pathname) {
  if (/(leads\/columns|columns\/leads)$/.test(pathname)) return {};
  if (/\/customers$|\/employee\/leads$/.test(pathname)) return LEADS;
  if (/\/tasks$/.test(pathname)) return TASKS;
  if (/\/employees$|coworkers/.test(pathname)) return EMPLOYEES;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { id: 2, name: 'Sara', permissions: {} };
  if (/home\/summary$/.test(pathname)) return { partial: [], allowed: null, my_tasks: [], task_status: [] };
  if (/home\/layout$/.test(pathname)) return { widgets: [] };
  if (/home\/calendar$/.test(pathname)) return { connected: false, events: [] };
  if (/status$/.test(pathname)) return { configured: false, connected: false };
  return GENERIC;
}

async function openPortal(browser, o) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g|google\.com/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname)) });
    }
    if (u.pathname === o.route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(o.file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => {
    localStorage.setItem(k, 'T');
    window.lucide = { createIcons() {} };
  }, o.tokenKey);
  await page.goto('http://127.0.0.1:' + o.port + o.route, { waitUntil: 'domcontentloaded' });
  await sleep(500);
  await page.evaluate(o.bootstrap);
  await sleep(700);
  return { page, errs };
}

// Everything measured on the page, in one pass.
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const seen = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  // Which elements stick out past the right edge, so a failure names a culprit.
  const wide = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!seen(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 8) {
      wide.push((el.id ? '#' + el.id : el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase())
        + '@' + Math.round(r.right));
    }
  });
  // Name an element well enough to find it: its own id/class, or failing that the
  // nearest ancestor that has one, so an anonymous <button> is still traceable.
  const name = el => {
    if (el.id) return '#' + el.id;
    if (el.className && typeof el.className === 'string' && el.className.trim())
      return '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.');
    let p = el.parentElement, hops = 0;
    while (p && hops++ < 3) {
      if (p.id) return el.tagName.toLowerCase() + '<#' + p.id;
      if (p.className && typeof p.className === 'string' && p.className.trim())
        return el.tagName.toLowerCase() + '<.' + p.className.trim().split(/\\s+/)[0];
      p = p.parentElement;
    }
    return el.tagName.toLowerCase();
  };
  const small = [];
  document.querySelectorAll('button, a.btn, .notif-bell, .hamburger, .modal-close').forEach(el => {
    if (!seen(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  // A checkbox is UA-sized and looks wrong at 44px. The standard asks for a 44px hit
  // area, not a 44px box — so the box must be >= 24px and its row must carry the rest.
  document.querySelectorAll('input[type=checkbox]').forEach(el => {
    if (!seen(el)) return;
    const r = el.getBoundingClientRect();
    const row = el.closest('td, th, label, .bulk-bar, li, .home-w') || el.parentElement;
    const rr = row ? row.getBoundingClientRect() : r;
    if (r.width < 24 || r.height < 24 || rr.height < 44) {
      small.push(name(el) + ' box ' + Math.round(r.width) + 'x' + Math.round(r.height)
        + ' hit ' + Math.round(rr.height));
    }
  });
  const tiny = [];
  document.querySelectorAll('input, select, textarea').forEach(el => {
    if (!seen(el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) tiny.push((el.id || el.className || el.tagName) + '@' + fs + 'px');
  });
  return {
    scrollW: document.documentElement.scrollWidth, vw,
    overflow: document.documentElement.scrollWidth - vw,
    wide: [...new Set(wide)].slice(0, 6),
    small: [...new Set(small)].slice(0, 6), smallCount: small.length,
    tiny: [...new Set(tiny)].slice(0, 6), tinyCount: tiny.length,
  };
})()`;

async function sweep(browser, o) {
  const { page, errs } = await openPortal(browser, o);
  const bad = { overflow: [], touch: [], font: [] };

  for (const pg of o.pages) {
    await page.evaluate(p => { try { navigate(p); } catch (_) {} }, pg);
    await sleep(320);
    const m = await page.evaluate(MEASURE);
    if (m.overflow > 1) bad.overflow.push(`${pg} +${m.overflow}px ${m.wide.join(' ')}`);
    if (m.smallCount) bad.touch.push(`${pg}: ${m.small.join(' ')}`);
    if (m.tinyCount) bad.font.push(`${pg}: ${m.tiny.join(' ')}`);
  }

  // ── Tables must have become cards ──
  // Scrolling a 20-column table sideways on a phone is not a fix: you see two columns
  // and the row's own actions are off-screen. Below 700px each row is a card and each
  // cell a labelled line, so this checks the rows actually stacked, the labels came
  // from the table's own headers, and nothing sits outside the viewport.
  const cardPages = (o.tablePages || []).filter(p => o.pages.includes(p));
  const notCards = [], unlabelled = [], offscreen = [];
  for (const pg of cardPages) {
    await page.evaluate(p => { try { navigate(p); } catch (_) {} }, pg);
    await sleep(350);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.table-scroll table tbody tr')]
        .filter(tr => tr.offsetParent !== null && !(tr.children.length === 1 && tr.children[0].hasAttribute('colspan')));
      if (!rows.length) return { none: true };
      const row = rows[0];
      const cells = [...row.children].filter(c => c.offsetParent !== null);
      const vw = document.documentElement.clientWidth;
      return {
        display: getComputedStyle(row).display,
        cells: cells.length,
        labelled: cells.filter(c => (c.getAttribute('data-label') || '').length).length,
        widest: Math.max(...cells.map(c => Math.round(c.getBoundingClientRect().right))),
        vw,
      };
    });
    if (r.none) continue;
    if (r.display !== 'block') notCards.push(`${pg}:${r.display}`);
    // Every cell that carries data needs a label; spacer cells legitimately have none.
    if (r.labelled < Math.max(1, r.cells - 2)) unlabelled.push(`${pg}:${r.labelled}/${r.cells}`);
    if (r.widest > r.vw + 1) offscreen.push(`${pg}:${r.widest}>${r.vw}`);
  }

  const t = (n, ok, x) => check(o.label + ': ' + n, ok, x);
  if (cardPages.length) {
    t(`table rows stack into cards (${cardPages.length} pages)`, !notCards.length, notCards.join(' '));
    t('every card field carries its column name', !unlabelled.length, unlabelled.join(' '));
    t('no card field sits outside the screen', !offscreen.length, offscreen.join(' '));
  }
  // Pages still to be converted, named so the gap shrinks visibly instead of hiding in
  // a skipped test. Anything NOT on this list must not scroll sideways.
  const known = bad.overflow.filter(v => (o.knownOverflow || []).some(k => v.startsWith(k + ' ')));
  const unexpected = bad.overflow.filter(v => !known.includes(v));
  if (known.length) console.log(`  ..    ${o.label}: still to convert — ${known.map(v => v.split(' ')[0]).join(', ')}`);
  t(`no page scrolls sideways (${o.pages.length - (o.knownOverflow || []).length} of ${o.pages.length} pages)`,
    !unexpected.length, unexpected.slice(0, 4).join(' | '));
  t('every tappable control is at least 44px', !bad.touch.length, bad.touch.slice(0, 3).join(' | '));
  t('no text input is under 16px (iOS zooms below that)', !bad.font.length, bad.font.slice(0, 3).join(' | '));
  // ── Leads: paged, and safe to touch ──
  if (o.leadsPage) {
    await page.evaluate(p => { try { navigate(p); } catch (_) {} }, o.leadsPage);
    await sleep(500);
    const rowsOf = () => page.evaluate(sel =>
      [...document.querySelectorAll(sel + ' tr')].filter(tr => tr.getAttribute('data-id')).length, o.leadsBody);
    const first = await rowsOf();
    t(`leads renders a page, not all ${LEAD_COUNT}`, first === 50, `rows=${first}`);

    const more = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Load more/.test(x.textContent));
      if (!b) return null;
      const label = b.textContent.trim(); b.click(); return label;
    });
    await sleep(300);
    const second = await rowsOf();
    t('Load more appends the next page', !!more && second === 100, `${more} -> rows=${second}`);

    // A tap must open the record, not start an edit on whatever field it landed on.
    const tapped = await page.evaluate(() => {
      const cell = document.querySelector('[data-id] td[data-label="Notes"], [data-id] td[data-label="Car"]');
      if (!cell) return { err: 'no editable cell' };
      cell.click();
      return {
        editing: !!document.querySelector('[data-id] td input.form-input'),
        drawer: !!document.querySelector('.lead-drawer.open, #lead-drawer.open'),
      };
    });
    await sleep(200);
    t('tapping a field opens the record instead of editing it',
      tapped.editing === false, JSON.stringify(tapped));
    // Close it again — the drawer is now full width on a phone, so leaving it open
    // makes it the topmost overlay for anything that runs after this.
    await page.keyboard.press('Escape');
    await sleep(250);
  }

  // ── The quotation line-item row still works ──
  // Its layout class was added alongside an existing one that the remove button finds
  // with closest(); overwriting rather than appending it would have left the button
  // silently doing nothing, which no layout assertion would have noticed.
  if (o.quotePage) {
    // The quotation is a modal sheet now (shared quote.js, PO idiom) — open it
    // first; the row class and its remove button live inside the sheet.
    await page.evaluate(p => { try { navigate(p); } catch (_) {} }, o.quotePage);
    await sleep(400);
    const line = await page.evaluate(async sel => {
      try { await openQuoteForm(null); } catch (e) { return { err: String(e) }; }
      await new Promise(r => setTimeout(r, 200));
      addPricingRow(); addPricingRow();
      const before = document.querySelectorAll(sel).length;
      const rm = document.querySelector(sel + ' button.qt-remove');
      const reachable = !!(rm && rm.closest(sel));
      if (rm) rm.click();
      const after = document.querySelectorAll(sel).length;
      try { PROCFG.closeModal(); } catch (_) {}
      return { before, after, reachable };
    }, o.quoteRowSel);
    t('a line-item row keeps the class its remove button looks for', line.reachable, JSON.stringify(line));
    t('removing a line item actually removes it',
      line.before > 0 && line.after === line.before - 1, JSON.stringify(line));
  }

  // ── Escape closes an open overlay ──
  // Nothing in either portal bound Escape; the Create Employee form's only reachable
  // control was the × at the top of a very long scroll.
  if (o.openModal) {
    await page.evaluate(p => { try { navigate(p); } catch (_) {} }, o.openModal.page);
    await sleep(350);
    const esc = await page.evaluate(fn => {
      try { window[fn](); } catch (e) { return { err: String(e) }; }
      return null;
    }, o.openModal.fn);
    await sleep(300);
    const shown = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      return !!(el && getComputedStyle(el).display !== 'none');
    }, o.openModal.sel);
    await page.keyboard.press('Escape');
    await sleep(300);
    const afterEsc = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      return !!(el && getComputedStyle(el).display !== 'none');
    }, o.openModal.sel);
    t('a modal opens', shown && !esc, JSON.stringify({ shown, esc }));
    t('Escape closes it', shown && !afterEsc, JSON.stringify({ shown, afterEsc }));

    // And the modal is measured against the dynamic viewport, not the largest one.
    const mh = await page.evaluate(sel => {
      const wrap = document.querySelector(sel);
      const box = (wrap && (wrap.querySelector('.modal') || wrap.firstElementChild))
        || document.querySelector('.modal');
      return box ? getComputedStyle(box).maxHeight : null;
    }, o.openModal.sel);
    t('the modal height resolves against the viewport', mh && mh !== 'none', String(mh));
  }

  // ── The calendar is legible on a phone ──
  // It used to be Google's embed in agenda mode; it is our own grid now, which
  // has to survive 390px without the chips turning it into a wall of text.
  {
    await page.evaluate(() => { try { navigate('calendar'); } catch (_) {} });
    await sleep(600);
    const cal = await page.evaluate(() => {
      const host = document.getElementById('ml-calendar');
      if (!host || !host.querySelector('.cal-day')) return null;
      const day = host.querySelector('.cal-day');
      const chip = host.querySelector('.cal-chip');
      return { grid: host.querySelectorAll('.cal-day').length,
               dayH: day.getBoundingClientRect().height,
               wide: host.scrollWidth > host.clientWidth + 2,
               chipText: chip ? getComputedStyle(chip).fontSize : null };
    });
    if (cal) {
      t('the calendar grid fits the phone without scrolling sideways', cal.wide === false, JSON.stringify(cal));
      t('…with compact day cells, and chips reduced to their icon',
        cal.dayH < 120 && (cal.chipText === null || cal.chipText === '0px'), JSON.stringify(cal));
    }
  }

  // ── Home widgets are sized by their content ──
  {
    await page.evaluate(() => { try { navigate('home'); } catch (_) {} });
    await sleep(500);
    const home = await page.evaluate(() => {
      const w = document.querySelector('.home-w');
      const editBtn = document.getElementById('home-edit-btn');
      return {
        minHeight: w ? getComputedStyle(w).minHeight : null,
        editHidden: !editBtn || getComputedStyle(editBtn).display === 'none',
      };
    });
    if (home.minHeight !== null) {
      t('home widgets are not held open by a desktop minimum height',
        home.minHeight === '0px' || home.minHeight === 'auto', String(home.minHeight));
    }
    t('layout editing is out of the way on a phone', home.editHidden, JSON.stringify(home));
  }

  t('no page errors while sweeping', !errs.length, errs.slice(0, 2).join(' | '));
  await page.close();
  return bad;
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  await sweep(browser, {
    label: 'admin', port, route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token',
    bootstrap: () => {},
    tablePages: ['tasks', 'employees', 'requests', 'submissions', 'hours', 'customers',
                 'contracts', 'purchaseorders', 'rfqs', 'suppliers', 'drive', 'sheets'],
    leadsPage: 'customers', leadsBody: '#customers-tbody',
    quotePage: 'quotation', quoteRowSel: '.qt-item-row',
    openModal: { page: 'employees', fn: 'openEmpModal', sel: '#modal-overlay' },
    pages: ['home', 'tasks', 'employees', 'requests', 'submissions', 'deletions', 'hours',
            'quotation', 'customers', 'deals', 'suppliers', 'rfqs', 'stock', 'contracts',
            'purchaseorders', 'reports', 'automations', 'chat', 'notif', 'calendar', 'meet',
            'email', 'drive', 'sheets', 'whatsapp'],
  });

  await sweep(browser, {
    label: 'team', port, route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token',
    bootstrap: () => {
      window.empInfo = { id: 2, name: 'Sara' };
      applyPermissions({ requests: true, drive: true, sheets: true, quotation: true,
                         leads: true, deals: true, reports: true });
      document.getElementById('layout').style.display = 'flex';
    },
    tablePages: ['tasks', 'hours', 'requests', 'leads', 'drive', 'sheets'],
    leadsPage: 'leads', leadsBody: '#emp-leads-tbody',
    quotePage: 'quotation', quoteRowSel: '.qt-item-row',
    openModal: { page: 'leads', fn: 'openEmpLeadModal', sel: '#emp-lead-modal' },
    pages: ['home', 'tasks', 'hours', 'requests', 'leads', 'deals', 'reports',
            'quotation', 'chat', 'notif', 'calendar', 'meet', 'email', 'drive', 'sheets',
            // Operations, shared with the dashboard via procurement.js
            'suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions'],
  });

  await browser.close(); srv.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} mobile checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
