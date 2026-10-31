// The new app's RFQ and Purchase-order screens against the classic portals', value by value — the same method as tests/supparity.js
// (see there): the classic page and the new app opened as the same person, in both portals, both colour modes and two looks, at a
// phone's width, two in-betweens and a desktop, and the computed style of every named part compared, and the words in them.
//
//   rfqList      the RFQs: one in each of two statuses (one with a colour the administrator gave it), one with no supplier and no date
//   rfqLoading   the server is slow to answer          rfqEmpty    none yet          rfqError     the server could not be asked
//   rfqForm      "New RFQ": what the server starts it with (eight lines, the standing accessories), then the same refused (no vehicle)
//   rfqFormEdit  an RFQ opened for editing, with its supplier, its lines and its extra fields
//   poList       the purchase orders (a total, a currency, a status in each)            poLoading  poEmpty  poError
//   poForm       "New purchase order" and the same refused       poFormEdit  one opened for editing, with lines in three statuses
//   catalogue    "From supplier catalogue": the small sheet over the form, with its search box and the vehicles of every supplier
//   viewer       a purchase order as a PDF, in the document viewer
//
// What the server says is the server's, and the same on both sides: this is one handler for the two portals, and the classic page
// and the new app ask it the same questions.
// Run with --print to see every difference rather than the first few; --only=admin (or team; or admin/original, team/loud/dark …) for
// a half or less; --states=a,b for a few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, sleep, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const ONLY = arg('only');
const STATE_FILTER = arg('states').split(',').filter(Boolean);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {};

const role = (c, x, text = false, y = 'abs', rel = 'root') => part(c, x, y, rel, text);
const free = (c, x, text = false) => part(c, x, 'abs', null, text);   // a dialog or a menu floats over the page: its place is the window's

// The two kinds of document, as each page and form name them.
const KINDS = {
  rfq: {
    screen: 'rfq', page: who => (who === 'admin' ? '#page-rfqs' : '#page-rfq'), list: '#rfqs-list', cols: 6, status: 4, actions: 6, lead: 'rfq-customer-id', form: { no: 'rfq-no', err: 'rfq-err' },
    // the form's sections, in order: [name, position]
    sections: { hdr: 1, sup: 2, lines: 3, pay: 4, grid2: 5, docs: 6, extras: 7 },
    fields: { hdr: 5, sup: 5, grid2: 3 },
    linesCols: [1, 2, 4, 5, 8, 9, 10], rowCells: [1, 2, 4, 6, 9, 10, 11],
  },
  po: {
    screen: 'purchaseorders', page: () => '#page-purchaseorders', list: '#po-list', cols: 7, status: 5, actions: 7, lead: 'po-customer-id', form: { no: 'po-number', err: 'po-err' },
    sections: { hdr: 1, lines: 2, sup: 3, pay: 4, grid2: 5, docs: 6, notes: 7, extras: 8 },
    fields: { hdr: 6, sup: 6, grid2: 4 },
    linesCols: [1, 2, 4, 5, 9, 12, 13, 16], rowCells: [1, 2, 4, 5, 9, 12, 15, 16],
  },
};

function rolesFor(who) {
  const R = {};
  for (const [k, K] of Object.entries(KINDS)) {
    const P = K.page(who), L = K.list, N = '[data-part=list] ';
    Object.assign(R, {
      [`${k}Root`]: part(P, '[data-part=docPage]', 'none'),
      [`${k}List`]: role(L, '[data-part=list]'),
      [`${k}Loading`]: role(`${L} .loading`, `${N}[data-part=loading]`, true),
      [`${k}Spinner`]: role(`${L} .spinner`, `${N}[data-part=loading] > :first-child`),
      [`${k}Error`]: role(`${L} .error-msg`, `${N}[data-part=error]`, true),
      [`${k}None`]: role(`${L} > div`, `${N}[data-part=none]`, true),
      [`${k}Scroll`]: role(`${L} .table-scroll`, `${N}[data-part=tableScroll]`),
      [`${k}Table`]: role(`${L} table`, `${N}[data-part=table]`),
      [`${k}HeadRow`]: role(`${L} thead tr`, `${N}[data-part=headRow]`),
    });
    for (let c = 1; c <= K.cols; c++) R[`${k}Th${c}`] = role(`${L} thead th:nth-child(${c})`, `${N}[data-part=headRow] > :nth-child(${c})`, true);
    for (const r of [1, 2, 3]) {
      const T = `${L} tbody tr:nth-child(${r})`, X = `${N}[data-part=row]:nth-child(${r})`;
      R[`${k}Row${r}`] = role(T, X);
      for (let c = 1; c <= K.cols; c++) R[`${k}Td${r}${c}`] = role(`${T} td:nth-child(${c})`, `${X} > :nth-child(${c})`, true);
      R[`${k}Pill${r}`] = role(`${T} td:nth-child(${K.status}) span`, `${X} > :nth-child(${K.status}) [data-part=badge]`, true);
      for (const [i, name, part_] of [[1, 'Edit', 'rowEdit'], [2, 'Export', 'rowExport'], [3, 'Delete', 'rowDelete']]) {
        R[`${k}${name}${r}`] = role(`${T} td:nth-child(${K.actions}) .btn:nth-of-type(${i})`, `${X} > :nth-child(${K.actions}) [data-part=${part_}]`, true);
      }
    }
    // the page around the list — each portal's own markup
    if (who === 'admin') {
      Object.assign(R, {
        [`${k}PageHead`]: role(`${P} .page-header`, '[data-part=pageHead]'),
        [`${k}PageTitle`]: role(`${P} .page-title`, '[data-part=pageTitle]', true),
        [`${k}Add`]: role(`${P} .page-header .btn`, '[data-part=add]', true),
        [`${k}PageBody`]: role(`${P} > div:has(> ${L})`, '[data-part=pageBody]'),
        [`${k}PageHint`]: role(`${P} > div:has(> ${L}) > div:first-child`, '[data-part=pageHint]', true),
      });
    } else {
      Object.assign(R, {
        [`${k}Root`]: part(P, '[data-part=page]', 'none'),
        [`${k}PageBody`]: role(`${P} > div:not(.ai-card)`, '[data-part=docPage]'),
        [`${k}PageHead`]: role(`${P} > div:not(.ai-card) > div:first-child`, '[data-part=pageHead]'),
        [`${k}PageTitle`]: role(`${P} .card-title`, '[data-part=pageTitle]', true),
        [`${k}PageHint`]: role(`${P} .card-title + div`, '[data-part=pageHint]', true),
        [`${k}Add`]: role(`${P} .btn-primary`, '[data-part=add]', true),
      });
    }
  }

  // the dialog the forms open in
  const D = '[data-part=dialog] ';
  Object.assign(R, {
    curtain: free('#modal-overlay', '[data-part=curtain]'),
    dialog: free('#modal-box', '[data-part=dialog]'),
    head2: free('#modal-box .modal-header', `${D}> [data-part=head]`),
    sTitle: free('#modal-title', `${D}> [data-part=head] > [data-part=title]`, true),
    close: free('#modal-box .modal-close', `${D}> [data-part=head] > [data-part=close]`, true),
    sBody: free('#modal-body', `${D}> [data-part=body]`),
    sFoot: free('#modal-footer', `${D}> [data-part=foot]`),
    cancelBtn: free('#modal-footer .btn:nth-child(1)', `${D}> [data-part=foot] > :nth-child(1)`, true),
    save1: free('#modal-footer .btn:nth-child(2)', `${D}> [data-part=foot] > :nth-child(2)`, true),
    saveBtn: free('#modal-footer .btn:nth-child(3)', `${D}> [data-part=foot] > :nth-child(3)`, true),
  });

  // the form: a column of sections (the classic sheet's own markup, in the same order), per kind of document
  const F = '#modal-body > div:first-child', XF = `${D}[data-part=docForm]`;
  const CTL = 'input, .bselect-trigger, textarea', XCTL = '[data-part=input], [data-part=pick], [data-part=area]';
  for (const [k, K] of Object.entries(KINDS)) {
    R[`${k}Form`] = free(F, XF);
    for (const [name, n] of Object.entries(K.sections)) R[`${k}S_${name}`] = free(`${F} > :nth-child(${n})`, `${XF} > :nth-child(${n})`);
    // a grid of fields: the section itself (hdr, grid2) or the grid under its label (sup)
    for (const [name, count] of Object.entries(K.fields)) {
      const n = K.sections[name];
      const G = name === 'sup' ? `${F} > :nth-child(${n}) > :nth-child(2)` : `${F} > :nth-child(${n})`;
      const XG = name === 'sup' ? `${XF} > :nth-child(${n}) > [data-part=fieldGrid]` : `${XF} > :nth-child(${n})`;
      R[`${k}G_${name}`] = free(G, XG);
      for (let i = 1; i <= count; i++) {
        R[`${k}F_${name}${i}`] = free(`${G} > :nth-child(${i})`, `${XG} > [data-part=field]:nth-child(${i})`);
        R[`${k}L_${name}${i}`] = free(`${G} > :nth-child(${i}) > .po-lbl`, `${XG} > [data-part=field]:nth-child(${i}) > [data-part=lbl]`, true);
        R[`${k}C_${name}${i}`] = free(`${G} > :nth-child(${i}) ${CTL.split(', ').map(s => s).join(`, ${G} > :nth-child(${i}) `)}`, `${XG} > [data-part=field]:nth-child(${i}) ${XCTL.split(', ').join(`, ${XG} > [data-part=field]:nth-child(${i}) `)}`, true);
      }
    }
    // a section that is a label over one box
    for (const name of ['pay', 'docs', 'notes']) {
      if (!K.sections[name]) continue;
      const n = K.sections[name];
      R[`${k}L_${name}`] = free(`${F} > :nth-child(${n}) > .po-lbl`, `${XF} > :nth-child(${n}) > [data-part=lbl]`, true);
      R[`${k}C_${name}`] = free(`${F} > :nth-child(${n}) > textarea`, `${XF} > :nth-child(${n}) > [data-part=area]`, true);
    }
    // the label over the supplier block and over the lines
    R[`${k}L_supBlock`] = free(`${F} > :nth-child(${K.sections.sup}) > .po-lbl`, `${XF} > :nth-child(${K.sections.sup}) > [data-part=lbl]`, true);
    // the lines
    const n = K.sections.lines, B = `${F} > :nth-child(${n})`, XB = `${XF} > :nth-child(${n})`;
    Object.assign(R, {
      [`${k}L_lines`]: free(`${B} > .po-lbl`, `${XB} > [data-part=lbl]`, true),
      [`${k}Frame`]: free(`${B} > div:nth-child(2)`, `${XB} > [data-part=gridFrame]`),
      [`${k}Grid`]: free(`${B} table`, `${XB} [data-part=grid]`),
      [`${k}GHead`]: free(`${B} thead tr`, `${XB} thead tr`),
    });
    for (const c of K.linesCols) R[`${k}GH${c}`] = free(`${B} thead th:nth-child(${c})`, `${XB} thead th:nth-child(${c})`, true);
    for (const r of [1, 2]) {
      R[`${k}GRow${r}`] = free(`${B} tbody tr:nth-child(${r})`, `${XB} tbody tr:nth-child(${r})`);
      for (const c of K.rowCells) {
        R[`${k}GCell${r}_${c}`] = free(`${B} tbody tr:nth-child(${r}) td:nth-child(${c})`, `${XB} tbody tr:nth-child(${r}) td:nth-child(${c})`, true);
        R[`${k}GIn${r}_${c}`] = free(`${B} tbody tr:nth-child(${r}) td:nth-child(${c}) .form-input, ${B} tbody tr:nth-child(${r}) td:nth-child(${c}) input[type=checkbox], ${B} tbody tr:nth-child(${r}) td:nth-child(${c}) .bselect-trigger`,
          `${XB} tbody tr:nth-child(${r}) td:nth-child(${c}) [data-part=gridInput], ${XB} tbody tr:nth-child(${r}) td:nth-child(${c}) [data-part=gridArea], ${XB} tbody tr:nth-child(${r}) td:nth-child(${c}) [data-part=gridBox], ${XB} tbody tr:nth-child(${r}) td:nth-child(${c}) [data-part=gridSelect]`);
      }
      R[`${k}GRemove${r}`] = free(`${B} tbody tr:nth-child(${r}) td:last-child .btn`, `${XB} tbody tr:nth-child(${r}) td:last-child [data-part=gridRemove]`, true);
    }
    // under the lines: a flex row of buttons and the total (purchase orders), or the buttons in a run (RFQs)
    if (k === 'po') {
      Object.assign(R, {
        poBar: free(`${B} > div:nth-child(3)`, `${XB} > [data-part=linesBar]`),
        poAddLine: free(`${B} > div:nth-child(3) > .btn:nth-of-type(1)`, `${XB} > [data-part=linesBar] > [data-part=addLine]`, true),
        poFromCat: free(`${B} > div:nth-child(3) > .btn:last-of-type`, `${XB} > [data-part=linesBar] > [data-part=fromCatalogue]`, true),
        poTotal: free('#po-total', `${XB} [data-part=linesTotal]`, true),
      });
    } else {
      Object.assign(R, {
        rfqAddLine: free(`${B} > .btn:nth-of-type(1)`, `${XB} > [data-part=addLine]`, true),
        rfqFromCat: free(`${B} > .btn:last-of-type`, `${XB} > [data-part=fromCatalogue]`, true),
      });
    }
    // the extra fields (the administrator's controls, and whatever fields were added)
    const E = `${F} > :nth-child(${K.sections.extras})`, XE = `${XF} > :nth-child(${K.sections.extras})`;
    Object.assign(R, {
      [`${k}Extras`]: free(E, XE),
      [`${k}ExtrasHead`]: free(`${E} > div:nth-child(1)`, `${XE} > [data-part=extrasHead]`),
      [`${k}ExtrasLbl`]: free(`${E} > div:nth-child(1) > .po-lbl`, `${XE} > [data-part=extrasHead] > [data-part=lbl]`, true),
      [`${k}ExtrasGrid`]: free(`${E} > [data-doc-extras]`, `${XE} > [data-part=extrasGrid]`),
      [`${k}ExtrasNone`]: free(`${E} > div:nth-child(2)`, `${XE} > [data-part=extrasNone]`, true),
      [`${k}ExtraF1`]: free(`${E} [data-doc-extras] > .form-group:nth-child(1)`, `${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1)`),
      [`${k}ExtraL1`]: free(`${E} [data-doc-extras] > .form-group:nth-child(1) .form-label`, `${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1) [data-part=fieldLabel]`, true),
      [`${k}ExtraC1`]: free(`${E} [data-doc-extras] > .form-group:nth-child(1) .form-control, ${E} [data-doc-extras] > .form-group:nth-child(1) .bselect-trigger`, `${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1) [data-part=fieldInput], ${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1) [data-part=fieldSelect]`),
    });
    R[`${k}FormErr`] = free(`#${K.form.err}`, `${XF} [data-part=formError]`, true);
  }
  // the buttons the administrator has over a grid, and over the extras
  Object.assign(R, {
    colsBtn: free(`${F} .btn[onclick*="openPicker"]`, `${XF} [data-part=colsButton]`, true),
    fieldBtn: free(`${F} .btn[onclick*="openAddModal"]`, `${XF} [data-part=fieldButton]`, true),
  });

  // the small sheet that picks from the catalogue
  Object.assign(R, {
    hdCurtain: free('#hd-sheet', '[data-part=hdCurtain]'),
    hdBox: free('#hd-sheet .hd-sheet-box', '[data-part=hdSheet]'),
    hdHead: free('#hd-sheet .hd-sheet-head', '[data-part=hdHead]'),
    hdTitle: free('#hd-sheet .hd-sheet-title', '[data-part=hdTitle]', true),
    hdX: free('#hd-sheet .hd-sheet-x', '[data-part=hdClose]', true),
    hdBody: free('#hd-sheet .hd-sheet-body', '[data-part=hdBody]'),
    hdFoot: free('#hd-sheet .hd-sheet-foot', '[data-part=hdFoot]'),
    hdCancel: free('#hd-sheet .hd-sheet-foot .btn:nth-child(1)', '[data-part=hdFoot] > [data-part=catCancel]', true),
    hdAdd: free('#hd-sheet .hd-sheet-foot .btn:nth-child(2)', '[data-part=hdFoot] > [data-part=catAdd]', true),
    catSearch: free('#supcat-q', '[data-part=catSearch]'),
    catList: free('#supcat-list', '[data-part=catList]'),
    catRow1: free('#supcat-list .hd-row:nth-child(1)', '[data-part=catList] > [data-part=catRow]:nth-child(1)', true),
    catBox1: free('#supcat-list .hd-row:nth-child(1) input', '[data-part=catList] > [data-part=catRow]:nth-child(1) input'),
    catName1: free('#supcat-list .hd-row:nth-child(1) > span > span:nth-child(1)', '[data-part=catList] > [data-part=catRow]:nth-child(1) > span > span:nth-child(1)', true),
    catSub1: free('#supcat-list .hd-row:nth-child(1) > span > span:nth-child(2)', '[data-part=catList] > [data-part=catRow]:nth-child(1) > span > span:nth-child(2)', true),
    catRow2: free('#supcat-list .hd-row:nth-child(2)', '[data-part=catList] > [data-part=catRow]:nth-child(2)', true),
  });

  // the document viewer
  Object.assign(R, {
    vCurtain: free('#doc-modal', '[data-part=docModal]'),
    vCard: free('#doc-modal > div', '[data-part=docCard]'),
    vHead: free('#doc-modal > div > div:nth-child(1)', '[data-part=docHead]'),
    vTitle: free('#doc-modal > div > div:nth-child(1) > div:nth-child(1)', '[data-part=docTitle]'),
    vText: free('#doc-modal-title', '[data-part=docTitleText]', true),
    vButtons: free('#doc-modal > div > div:nth-child(1) > div:nth-child(2)', '[data-part=docButtons]'),
    vDownload: free('#doc-modal .btn-primary', '[data-part=docDownload]', true),
    vClose: free('#doc-modal .btn-outline', '[data-part=docClose]', true),
    vBody: free('#doc-modal > div > div:nth-child(2)', '[data-part=docBody]'),
    vLoading: free('#doc-modal-loading', '[data-part=docLoading]', true),
    vFrame: free('#doc-preview-frame', '[data-part=docFrame]'),
  });
  return R;
}

// What a state reads (a part that is not there on either side is not compared, one that is on one side only is a failure)
const pageParts = k => [`${k}Root`, `${k}PageHead`, `${k}PageTitle`, `${k}Add`, `${k}PageBody`, `${k}PageHint`, `${k}List`];
const tableParts = k => {
  const K = KINDS[k];
  return [`${k}Scroll`, `${k}Table`, `${k}HeadRow`, ...Array.from({ length: K.cols }, (_, i) => `${k}Th${i + 1}`),
    ...[1, 2, 3].flatMap(r => [`${k}Row${r}`, `${k}Pill${r}`, `${k}Edit${r}`, `${k}Export${r}`, `${k}Delete${r}`, ...Array.from({ length: K.cols }, (_, i) => `${k}Td${r}${i + 1}`)])];
};
const DIALOG = ['curtain', 'dialog', 'head2', 'sTitle', 'close', 'sBody', 'sFoot', 'cancelBtn', 'save1', 'saveBtn'];
const formParts = k => {
  const K = KINDS[k];
  const out = [`${k}Form`, ...Object.keys(K.sections).map(s => `${k}S_${s}`)];
  for (const [name, count] of Object.entries(K.fields)) {
    out.push(`${k}G_${name}`);
    for (let i = 1; i <= count; i++) out.push(`${k}F_${name}${i}`, `${k}L_${name}${i}`, `${k}C_${name}${i}`);
  }
  for (const name of ['pay', 'docs', 'notes']) if (K.sections[name]) out.push(`${k}L_${name}`, `${k}C_${name}`);
  out.push(`${k}L_supBlock`, `${k}L_lines`, `${k}Frame`, `${k}Grid`, `${k}GHead`, ...K.linesCols.map(c => `${k}GH${c}`));
  for (const r of [1, 2]) out.push(`${k}GRow${r}`, `${k}GRemove${r}`, ...K.rowCells.flatMap(c => [`${k}GCell${r}_${c}`, `${k}GIn${r}_${c}`]));
  out.push(...(k === 'po' ? ['poBar', 'poAddLine', 'poFromCat', 'poTotal'] : ['rfqAddLine', 'rfqFromCat']));
  out.push(`${k}Extras`, `${k}ExtrasHead`, `${k}ExtrasLbl`, 'colsBtn', 'fieldBtn');
  return out;
};
const CAT = ['hdCurtain', 'hdBox', 'hdHead', 'hdTitle', 'hdX', 'hdBody', 'hdFoot', 'hdCancel', 'hdAdd', 'catSearch', 'catList', 'catRow1', 'catBox1', 'catName1', 'catSub1', 'catRow2'];
const VIEWER = ['vCurtain', 'vCard', 'vHead', 'vTitle', 'vText', 'vButtons', 'vDownload', 'vClose', 'vBody', 'vLoading'];
const READS = {
  rfqList: [...pageParts('rfq'), ...tableParts('rfq')],
  rfqLoading: [...pageParts('rfq'), 'rfqLoading', 'rfqSpinner'],
  rfqEmpty: [...pageParts('rfq'), 'rfqNone'],
  rfqError: [...pageParts('rfq'), 'rfqError'],
  rfqForm: [...DIALOG, ...formParts('rfq')],
  rfqFormEdit: [...DIALOG, ...formParts('rfq'), 'rfqExtrasGrid', 'rfqExtraF1', 'rfqExtraL1', 'rfqExtraC1'],
  rfqFormError: [...DIALOG, ...formParts('rfq'), 'rfqFormErr'],
  poList: [...pageParts('po'), ...tableParts('po')],
  poLoading: [...pageParts('po'), 'poLoading', 'poSpinner'],
  poEmpty: [...pageParts('po'), 'poNone'],
  poError: [...pageParts('po'), 'poError'],
  poForm: [...DIALOG, ...formParts('po')],
  poFormEdit: [...DIALOG, ...formParts('po'), 'poExtrasGrid', 'poExtraF1', 'poExtraL1', 'poExtraC1'],
  poFormError: [...DIALOG, ...formParts('po'), 'poFormErr'],
  catalogue: [...CAT],
  viewer: [...VIEWER],
};
// …and the words that are the server's, not the page's — and so what the length of them decides (how tall the box is)
const NO_WORDS = new Set();
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What the pages hold. Times are far from "now" so they read the same in two pages opened a while apart.
const at = d => new Date(Date.UTC(2026, 8, d, 10, 30)).toISOString();
const suppliers = () => [
  { id: 1, name: 'Yu Motors', contact: 'yu@example.com', address: 'Shanghai, Pudong District', country: 'China', notes: '', custom_fields: {}, created_by: 'admin', created_at: at(1), updated_at: at(1) },
  { id: 2, name: 'Gulf Auto Trading', contact: 'sales@gulf.example.com', address: 'Jebel Ali', country: 'United Arab Emirates', notes: '', custom_fields: {}, created_by: 'admin', created_at: at(2), updated_at: at(2) },
];
const catalogue = () => [
  { id: 1, supplier_id: 1, brand: 'BYD', model: 'Seal', trim: 'Max', model_year: 2026, availability: 'Pre-order', fob_price: 32789, currency: 'USD', lead_time: '4 to 6 weeks', accessories: 'mats, charger', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors' } },
  { id: 2, supplier_id: 1, brand: 'Aion', model: 'Y', trim: '', model_year: null, availability: '', fob_price: null, currency: 'USD', lead_time: '', accessories: '', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors' } },
  { id: 3, supplier_id: 2, brand: 'Geely', model: 'Starray', trim: '', model_year: 2026, availability: 'Available', fob_price: 21000, currency: 'USD', lead_time: '8 weeks', accessories: '', notes: '', custom_fields: {}, suppliers: { name: 'Gulf Auto Trading' } },
];
// (a row the database holds has every column: what a form leaves empty is null)
const RFQ_BLANK = { supplier_id: null, supplier_name: null, supplier_contact: null, supplier_address: null, supplier_country: null, issuer: null, rfq_date: null, customer_id: null,
  payment_terms: null, delivery_location: null, service_provider: null, contact: null, documents_required: null, custom_fields: {}, items: [], created_by: 'admin', updated_at: null };
const PO_BLANK = { supplier_id: null, supplier: null, supplier_contact: null, supplier_address: null, supplier_country: null, issuer: null, quote_id: null, po_date: null, customer_id: null, notes: null,
  incoterm: null, payment_terms: null, delivery_location: null, service_provider: null, contact: null, documents_required: null, custom_fields: {}, items: [], created_by: 'admin', updated_at: null };
const rfqs = () => [
  { id: 1, rfq_no: 'MT26W036Y26', title: 'Yu Motors — 2 vehicle(s)', supplier_id: 1, supplier_name: 'Yu Motors', supplier_contact: 'yu@example.com', supplier_address: 'Shanghai', supplier_country: 'China', issuer: 'Admin', rfq_date: '2026-09-02', status: 'sent', customer_id: null,
    payment_terms: '30% deposit', delivery_location: 'Alexandria', service_provider: 'Maersk', contact: 'ops@example.com', documents_required: 'B/L, invoice', custom_fields: { cf_ref: 'R-77', cf_urgent: true },
    items: [{ brand: 'BYD', model: 'Seal', trim: 'Max', colour: 'White / Black', year: '2026', accessories: 'mats', lead_time: '4 weeks', fob_price: 32000, cif_price: 34000 }, { brand: 'Aion', model: 'Y', cif_price: '' }], created_by: 'admin', created_at: at(2) },
  { id: 2, rfq_no: 'MT26W037Y26', title: 'RFQ — 1 vehicle(s)', supplier_id: null, supplier_name: null, issuer: null, rfq_date: null, status: 'answered', customer_id: null, items: [{ brand: 'Geely' }], custom_fields: {}, created_by: 'admin', created_at: at(3) },
  { id: 3, rfq_no: 'MT26W038Y26', title: 'x', supplier_name: 'Gulf Auto Trading', rfq_date: '2026-09-04', status: 'archived', customer_id: null, items: [], custom_fields: {}, created_by: 'admin', created_at: at(4) },
].map(r => ({ ...RFQ_BLANK, ...r }));
const orders = () => [
  { id: 1, po_number: 'PO2026-0001', title: 'Yu Motors — 2 vehicle(s)', supplier_id: 1, supplier: 'Yu Motors', supplier_contact: 'yu@example.com', supplier_address: 'Shanghai', supplier_country: 'China', issuer: 'Admin', quote_id: 'MT26W036Y26', po_date: '2026-09-03', currency: 'USD', status: 'confirmed', customer_id: null, notes: 'Ship together', incoterm: 'CIF',
    payment_terms: '', delivery_location: 'Alexandria', service_provider: '', contact: '', documents_required: '', custom_fields: { cf_ref: 'P-9', cf_urgent: false },
    items: [{ client: 'Ali Hassan', consignee: 'Ali H.', units: 2, brand: 'BYD', model: 'Seal', trim: 'Max', color: 'White / Black', year: '2026', accessories: 'mats', payment_term: '30/70', pi_price: 31000, status: 'in_logistics', vin: '', file_link: 'https://drive.example/f1' }, { client: 'Sara', units: 1, brand: 'Aion', model: 'Y', pi_price: 21500, status: 'delivered' }, { client: 'Omar', units: '', brand: 'Geely', pi_price: '', status: 'send_to_supplier' }], created_by: 'admin', created_at: at(3) },
  { id: 2, po_number: 'PO2026-0002', title: 'x', supplier: '', po_date: null, currency: 'EUR', status: 'draft', customer_id: null, items: [{ client: 'Nora' }], custom_fields: {}, created_by: 'admin', created_at: at(4) },
].map(r => ({ ...PO_BLANK, ...r }));
const configs = () => [
  { key: 'columns_config:rfq_doc', value: JSON.stringify([
    { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [{ key: 'draft', label: 'Draft', color: '#b9b3a4' }, { key: 'sent', label: 'Sent', color: '#e69650' }, { key: 'answered', label: 'Answered', color: '#10b981' }, { key: 'closed', label: 'Closed', color: '#888888' }] },
    { key: 'cf_ref', label: 'Reference', type: 'text', builtin: false, visible: true },
    { key: 'cf_urgent', label: 'Urgent', type: 'checkbox', builtin: false, visible: true },
  ]) },
  { key: 'columns_config:po_doc', value: JSON.stringify([
    { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [{ key: 'draft', label: 'Draft', color: '#b9b3a4' }, { key: 'sent', label: 'Sent', color: '#e69650' }, { key: 'confirmed', label: 'Confirmed', color: '#10b981' }, { key: 'closed', label: 'Closed', color: '#888888' }] },
    { key: 'cf_ref', label: 'Reference', type: 'text', builtin: false, visible: true },
    { key: 'cf_urgent', label: 'Urgent', type: 'checkbox', builtin: false, visible: true },
  ]) },
];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 4004 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  let stub = null;   // what the server is made to say instead, for the states a real one cannot be put in
  const stubbed = (u, m) => (stub ? stub(u, m) : null);

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const ROLES = rolesFor(p.who);
    const states = Object.keys(READS).filter(s => !STATE_FILTER.length || STATE_FILTER.includes(s));
    const reset = () => {
      db.tables.suppliers = suppliers(); db.tables.supplier_vehicles = catalogue(); db.tables.rfqs = rfqs(); db.tables.purchase_orders = orders();
      db.tables.quotation_settings = (db.tables.quotation_settings || []).filter(r => !/^columns_config:(rfq_|po_|rfq_items|po_items)/.test(r.key)).concat(configs());
      db.failing.clear(); db.latency = 0; stub = null;
    };
    reset();
    const page = await openPage(browser, base, p, mode, next, stubbed);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    // (a native confirm or prompt would stop the page: the suite answers them)
    await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=list], #rfqs-list, #po-list') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const exists = (classic, now, what) => until(s => !!document.querySelector(s), pick(classic, now), what);
    const gone = (classic, now, what) => until(s => !document.querySelector(s), pick(classic, now), what);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const reading = async state => {
      const which = Object.fromEntries(READS[state].map(r => [r, ROLES[r]]).filter(([, d]) => d));
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS_MORE);
        if (NO_WORDS.has(state)) for (const r of Object.values(got)) if (r) delete r._text;
        (observed[at] = observed[at] || {})[side] = got;
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };
    const go = to => page.evaluate((next, to) => {
      if (!next) return window.navigate(to);
      document.querySelector(`[data-screen=${to}]`).click();
    }, next, to);
    // (the classic admin's page is 'rfqs'; the team's, like the new app's, is 'rfq')
    const SCREEN = { rfq: next || p.who === 'team' ? 'rfq' : 'rfqs', po: 'purchaseorders' };
    const LIST = { rfq: '#rfqs-list', po: '#po-list' };
    const open = async k => {
      await go(SCREEN[k]);
      await until(s => !!document.querySelector(s) && !document.querySelector(s + ' .loading, ' + s + ' [data-part=loading]'), pick(LIST[k], '[data-part=list]'), 'the list');
    };
    const leave = async k => {
      await go('home');
      await until(s => !document.querySelector(s), pick(KINDS[k].page(p.who) + '.active', '[data-part=docPage]'), 'the page to be left');
    };
    const reopen = async k => { await leave(k); await open(k); };
    const closeSheet = async () => {
      if (next) { await page.keyboard.press('Escape'); } else { await page.evaluate(() => hideModal()); }
      await gone('#modal-overlay[style*="flex"]', '[data-part=dialog]', 'the dialog to close');
    };
    const addButton = k => pick(p.who === 'admin' ? `${KINDS[k].page(p.who)} .page-header .btn` : `${KINDS[k].page(p.who)} .btn-primary`, '[data-part=add]');
    const formReady = k => exists(`#modal-body #${KINDS[k].form.no}`, '[data-part=dialog] [data-part=docForm] [data-part=field] input', 'the form');
    const rowButton = (k, row, n) => pick(`${LIST[k]} tbody tr:nth-child(${row}) td:last-child .btn:nth-of-type(${n})`, `[data-part=list] [data-part=row]:nth-child(${row}) [data-part=${['rowEdit', 'rowExport', 'rowDelete'][n - 1]}]`);

    for (const k of ['rfq', 'po']) {
      const S = states.filter(s => s.startsWith(k));
      // the list: the loader first (the server is slow), then the list as it is
      if (S.includes(`${k}Loading`)) {
        db.latency = 1500;
        await go(SCREEN[k]);
        await exists(`${LIST[k]} .loading`, '[data-part=list] [data-part=loading]', 'the loader');
        await reading(`${k}Loading`);
        db.latency = 0;
        await open(k);
      } else await open(k);
      if (S.includes(`${k}List`)) { await exists(`${LIST[k]} tbody tr`, '[data-part=list] [data-part=row]', 'the rows'); await reading(`${k}List`); }
      // empty, error
      if (S.includes(`${k}Empty`)) {
        db.tables[k === 'rfq' ? 'rfqs' : 'purchase_orders'] = [];
        await reopen(k);
        await until(s => { const c = document.querySelector(s); return !!c && /No (RFQs|purchase orders) yet/.test(c.textContent); }, pick(LIST[k], '[data-part=list]'), 'the empty list');
        await reading(`${k}Empty`);
        reset();
        await reopen(k);
      }
      if (S.includes(`${k}Error`)) {
        db.failing.add(k === 'rfq' ? 'rfqs' : 'purchase_orders');
        await reopen(k);
        await exists(`${LIST[k]} .error-msg`, '[data-part=list] [data-part=error]', 'the error');
        await reading(`${k}Error`);
        db.failing.clear();
        await reopen(k);
      }
      // the form, new: as the server starts it, then refused
      if (S.some(s => s === `${k}Form` || s === `${k}FormError`)) {
        await click(addButton(k), addButton(k));
        await formReady(k);
        await exists('#modal-body table tbody tr', '[data-part=dialog] table tbody tr', 'the lines');
        if (S.includes(`${k}Form`)) await reading(`${k}Form`);
        if (S.includes(`${k}FormError`)) {
          // (every line of an RFQ starts with its standing words but no vehicle: the refusal is the same on both sides)
          await click('#modal-footer .btn-primary', '[data-part=dialog] [data-part=save]');
          await exists(`#${KINDS[k].form.err}[style*="block"]`, '[data-part=dialog] [data-part=formError]', 'the refusal');
          await reading(`${k}FormError`);
        }
        await closeSheet();
      }
      // the form, opened on a document that has everything
      if (S.includes(`${k}FormEdit`)) {
        await click(rowButton(k, 1, 1), rowButton(k, 1, 1));
        await formReady(k);
        await exists('#modal-body table tbody tr', '[data-part=dialog] table tbody tr', 'the lines');
        // (what the form asks for after it opens — the suppliers, the leads — has come)
        await sleep(400);
        await reading(`${k}FormEdit`);
        // the small sheet that picks from the catalogue
        if (k === 'rfq' && states.includes('catalogue')) {
          await click('#modal-body .btn[onclick*="openCataloguePicker"]', '[data-part=dialog] [data-part=fromCatalogue]');
          await exists('#hd-sheet .hd-sheet-box', '[data-part=hdSheet]', 'the catalogue');
          await exists('#supcat-list .hd-row', '[data-part=catList] [data-part=catRow]', 'the vehicles');
          await reading('catalogue');
          await click('#hd-sheet .hd-sheet-x', '[data-part=hdClose]');
          await gone('#hd-sheet .hd-sheet-box', '[data-part=hdSheet]', 'the sheet to close');
        }
        await closeSheet();
      }
      // a purchase order, as a PDF
      if (k === 'po' && states.includes('viewer')) {
        stub = (u, m) => (m === 'POST' && /\/purchase-orders\/(\d+\/)?pdf$/.test(u) ? { status: 200, body: { pdf: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF').toString('base64'), name: 'PO2026-0001' } } : null);
        await click(rowButton(k, 1, 2), rowButton(k, 1, 2));
        await exists('#doc-modal[style*="display: flex"] #doc-preview-frame[style*="display: block"]', '[data-part=docModal] [data-part=docFrame]', 'the viewer');
        await reading('viewer');
        await click('#doc-modal .btn-outline', '[data-part=docClose]');
        await gone('#doc-modal[style*="display: flex"]', '[data-part=docModal]', 'the viewer to close');
        stub = null;
      }
    }
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const p of portals) for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${p.who}/${look}/${mode}`.startsWith(ONLY)) continue;
      await scenario(p, mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();

  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const { n, bad } = diff(classic, next, ACCEPTED, stale, PROPS_MORE);
    compared += n;
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!STATE_FILTER.length) {
    // (CI runs a half per suite, so a half has its own floor: a half that compared nothing must not pass)
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > (ONLY ? 300000 : 600000), String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
