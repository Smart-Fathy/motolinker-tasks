// The new app's Contracts screen against the classic portals', value by value — the same method as tests/docparity.js (see there):
// the classic page and the new app opened as the same person, in both portals, both colour modes and two looks, at a phone's
// width, two in-betweens and a desktop, and the computed style of every named part compared, and the words in them.
//
//   ctList       the contracts: a signed one with a lead, one a deal drafted for itself (the "auto" mark; the newest, so the first row),
//                one on the older wording with a status the administrator has since taken away and no date
//   ctLoading    the server is slow to answer          ctEmpty    none yet          ctError    the server could not be asked
//   ctForm       "New contract": what the server starts it with (the car-sale wording, one payment line), then the same refused (no buyer)
//   ctFormEdit   a car-sale contract opened for editing, with two payment lines and an extra field
//   ctFormLead   the same with a lead attached (the administrator's page only: the classic team page asks a route for its list of leads
//                that the team does not have, so the picker there is always empty — the new app lists the team's own leads)
//   ctFormOlder  a contract on the older wording: its own fields besides, and its payment lines as they were
//   ctViewer     a contract as a PDF, in the administrator's contract preview (the classic team page has no working preview — its
//                button looks for a `#ct-modal` the team's page does not have — so the team's viewer is the document viewer that
//                tests/docparity.js holds, and is not compared here)
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
const ABSENT = process.argv.includes('--absent');   // say which named parts a state found on neither side (a selector that matches nothing compares nothing)
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

const LIST = '#contracts-list';
const PAGE = '#page-contracts';
const COLS = 5, STATUS = 3, ACTIONS = 5;

// The blocks of the form, in order, and the number of fields in each of its grids: [name, position, [fields in the first grid, …]]
const BLOCKS = [['date', 1, [4]], ['company', 2, [5, 7]], ['buyer', 3, [6]], ['vehicle', 4, [5]], ['money', 5, [2]]];

function rolesFor(who) {
  const R = {};
  const P = PAGE, L = LIST, N = '[data-part=list] ';
  Object.assign(R, {
    ctRoot: part(P, '[data-part=docPage]', 'none'),
    ctList: role(L, '[data-part=list]'),
    ctLoading: role(`${L} .loading`, `${N}[data-part=loading]`, true),
    ctSpinner: role(`${L} .spinner`, `${N}[data-part=loading] > :first-child`),
    ctError: role(`${L} .error-msg`, `${N}[data-part=error]`, true),
    ctNone: role(`${L} > div`, `${N}[data-part=none]`, true),
    ctScroll: role(`${L} .table-scroll`, `${N}[data-part=tableScroll]`),
    ctTable: role(`${L} table`, `${N}[data-part=table]`),
    ctHeadRow: role(`${L} thead tr`, `${N}[data-part=headRow]`),
  });
  for (let c = 1; c <= COLS; c++) R[`ctTh${c}`] = role(`${L} thead th:nth-child(${c})`, `${N}[data-part=headRow] > :nth-child(${c})`, true);
  for (const r of [1, 2, 3]) {
    const T = `${L} tbody tr:nth-child(${r})`, X = `${N}[data-part=row]:nth-child(${r})`;
    R[`ctRow${r}`] = role(T, X);
    for (let c = 1; c <= COLS; c++) R[`ctTd${r}${c}`] = role(`${T} td:nth-child(${c})`, `${X} > :nth-child(${c})`, true);
    R[`ctPill${r}`] = role(`${T} td:nth-child(${STATUS}) span`, `${X} > :nth-child(${STATUS}) [data-part=badge]`, true);
    R[`ctAuto${r}`] = role(`${T} td:nth-child(2) span`, `${X} > :nth-child(2) [data-part=auto]`, true);
    for (const [i, name, part_] of [[1, 'Edit', 'rowEdit'], [2, 'Pdf', 'rowExport'], [3, 'Delete', 'rowDelete']]) {
      R[`ct${name}${r}`] = role(`${T} td:nth-child(${ACTIONS}) .btn:nth-of-type(${i})`, `${X} > :nth-child(${ACTIONS}) [data-part=${part_}]`, true);
    }
  }
  // the page around the list — each portal's own markup
  if (who === 'admin') {
    Object.assign(R, {
      ctPageHead: role(`${P} .page-header`, '[data-part=pageHead]'),
      ctPageTitle: role(`${P} .page-title`, '[data-part=pageTitle]', true),
      ctAdd: role(`${P} .page-header .btn`, '[data-part=add]', true),
      ctPageBody: role(`${P} > div:has(> ${L})`, '[data-part=pageBody]'),
      ctPageHint: role(`${P} > div:has(> ${L}) > div:first-child`, '[data-part=pageHint]', true),
    });
  } else {
    Object.assign(R, {
      ctRoot: part(P, '[data-part=page]', 'none'),
      ctPageBody: role(`${P} > div:not(.ai-card)`, '[data-part=docPage]'),
      ctPageHead: role(`${P} > div:not(.ai-card) > div:first-child`, '[data-part=pageHead]'),
      ctPageTitle: role(`${P} .card-title`, '[data-part=pageTitle]', true),
      ctPageHint: role(`${P} .card-title + div`, '[data-part=pageHint]', true),
      ctAdd: role(`${P} .btn-primary`, '[data-part=add]', true),
    });
  }

  // the dialog the form opens in
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

  // the form: a column of blocks (the classic sheet's own markup, in the same order)
  const F = '#modal-body > div:first-child', XF = `${D}[data-part=docForm]`;
  R.ctForm = free(F, XF);
  for (const [name, n, grids] of BLOCKS) {
    R[`ctS_${name}`] = free(`${F} > :nth-child(${n})`, `${XF} > :nth-child(${n})`);
    R[`ctBL_${name}`] = free(`${F} > :nth-child(${n}) > label`, `${XF} > :nth-child(${n}) > label`, true);
    grids.forEach((count, gi) => {
      const g = gi + 2;   // (the label is the block's first child)
      const G = `${F} > :nth-child(${n}) > :nth-child(${g})`, XG = `${XF} > :nth-child(${n}) > [data-part=ctGrid]:nth-child(${g})`;
      R[`ctG_${name}${gi + 1}`] = free(G, XG);
      for (let i = 1; i <= count; i++) {
        R[`ctF_${name}${gi + 1}_${i}`] = free(`${G} > :nth-child(${i})`, `${XG} > [data-part=ctField]:nth-child(${i})`);
        R[`ctC_${name}${gi + 1}_${i}`] = free(`${G} > :nth-child(${i}) > div`, `${XG} > [data-part=ctField]:nth-child(${i}) > div`, true);
        R[`ctI_${name}${gi + 1}_${i}`] = free(`${G} > :nth-child(${i}) > input`, `${XG} > [data-part=ctField]:nth-child(${i}) > input`);
      }
    });
  }
  // the car-sale contract's payment lines
  const PB = `${F} > :nth-child(5) > :nth-child(3)`, XPB = `${XF} > :nth-child(5) > [data-part=payments]`;
  Object.assign(R, {
    ctPayBox: free(PB, XPB),
    ctPayCap: free(`${PB} > :nth-child(1)`, `${XPB} > :nth-child(1)`, true),
    ctPayList: free('#ct-pay-list', `${XPB} [data-part=payList]`),
    ctPayAdd: free('#ct-pay-add', `${XPB} [data-part=addPay]`, true),
  });
  for (const r of [1, 2]) {
    const PR = `#ct-pay-list > :nth-child(${r})`, XPR = `${XPB} [data-part=payList] > [data-part=payRow]:nth-child(${r})`;
    Object.assign(R, {
      [`ctPay${r}`]: free(PR, XPR),
      [`ctPayAmount${r}`]: free(`${PR} [data-pay=amount]`, `${XPR} [data-pay=amount]`),
      [`ctPayWhen${r}`]: free(`${PR} [data-pay=when]`, `${XPR} [data-pay=when]`),
      [`ctPayDel${r}`]: free(`${PR} .ct-pay-del`, `${XPR} [data-part=payRemove]`, true),
    });
  }
  // …and an older contract's, which are only to be read beside their amounts
  for (const r of [1, 2]) {
    const FR = `${PB} > :nth-child(${r})`, XFR = `${XPB} > [data-part=payFixed]:nth-child(${r})`;
    Object.assign(R, {
      [`ctFixed${r}`]: free(FR, XFR),
      [`ctFixedAmount${r}`]: free(`${FR} > input`, `${XFR} > input`),
      [`ctFixedNote${r}`]: free(`${FR} > div`, `${XFR} > div`, true),
    });
  }
  // the older wording's fields besides: the import country (the vehicle block's sixth) and the late fee, its words and the deadline (the financials' 3rd to 5th)
  R.ctF_older_6 = free(`${F} > :nth-child(4) > :nth-child(2) > :nth-child(6)`, `${XF} > :nth-child(4) > [data-part=ctGrid]:nth-child(2) > [data-part=ctField]:nth-child(6)`);
  R.ctI_older_6 = free(`${F} > :nth-child(4) > :nth-child(2) > :nth-child(6) > input`, `${XF} > :nth-child(4) > [data-part=ctGrid]:nth-child(2) > [data-part=ctField]:nth-child(6) > input`);
  for (const i of [3, 4, 5]) {
    R[`ctF_older_m${i}`] = free(`${F} > :nth-child(5) > :nth-child(2) > :nth-child(${i})`, `${XF} > :nth-child(5) > [data-part=ctGrid]:nth-child(2) > [data-part=ctField]:nth-child(${i})`);
    R[`ctC_older_m${i}`] = free(`${F} > :nth-child(5) > :nth-child(2) > :nth-child(${i}) > div`, `${XF} > :nth-child(5) > [data-part=ctGrid]:nth-child(2) > [data-part=ctField]:nth-child(${i}) > div`, true);
  }
  // the lead and the status, side by side
  const CTL = 'select, .bselect-trigger';
  Object.assign(R, {
    ctPair: free(`${F} > :nth-child(6)`, `${XF} > [data-part=ctPair]`),
    ctPairL1: free(`${F} > :nth-child(6) > :nth-child(1) > label`, `${XF} > [data-part=ctPair] > :nth-child(1) > label`, true),
    ctPairC1: free(`${F} > :nth-child(6) > :nth-child(1) .bselect-trigger`, `${XF} > [data-part=ctPair] > :nth-child(1) [data-part=pick]`, true),
    ctPairL2: free(`${F} > :nth-child(6) > :nth-child(2) > label`, `${XF} > [data-part=ctPair] > :nth-child(2) > label`, true),
    ctPairC2: free(`${F} > :nth-child(6) > :nth-child(2) .bselect-trigger`, `${XF} > [data-part=ctPair] > :nth-child(2) [data-part=pick]`, true),
  });
  void CTL;
  // the extra fields (the administrator's controls, and whatever fields were added)
  const E = `${F} > :nth-child(7)`, XE = `${XF} > :nth-child(7)`;
  Object.assign(R, {
    ctExtras: free(E, XE),
    ctExtrasHead: free(`${E} > div:nth-child(1)`, `${XE} > [data-part=extrasHead]`),
    ctExtrasLbl: free(`${E} > div:nth-child(1) > .po-lbl`, `${XE} > [data-part=extrasHead] > [data-part=lbl]`, true),
    ctExtrasGrid: free(`${E} > [data-doc-extras]`, `${XE} > [data-part=extrasGrid]`),
    ctExtraF1: free(`${E} [data-doc-extras] > .form-group:nth-child(1)`, `${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1)`),
    ctExtraL1: free(`${E} [data-doc-extras] > .form-group:nth-child(1) .form-label`, `${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1) [data-part=fieldLabel]`, true),
    ctExtraC1: free(`${E} [data-doc-extras] > .form-group:nth-child(1) .form-control, ${E} [data-doc-extras] > .form-group:nth-child(1) .bselect-trigger`, `${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1) [data-part=fieldInput], ${XE} [data-part=extrasGrid] > [data-part=field]:nth-child(1) [data-part=fieldSelect]`),
    ctFormErr: free('#ct-err', `${XF} [data-part=formError]`, true),
    colsBtn: free(`${E} .btn[onclick*="openPicker"]`, `${XE} [data-part=colsButton]`, true),
    fieldBtn: free(`${E} .btn[onclick*="openAddModal"]`, `${XE} [data-part=fieldButton]`, true),
  });

  // the administrator's contract preview
  Object.assign(R, {
    vCurtain: free('#ct-modal', '[data-part=docModal]'),
    vCard: free('#ct-modal > div', '[data-part=docCard]'),
    vHead: free('#ct-modal > div > div:nth-child(1)', '[data-part=docHead]'),
    vTitle: free('#ct-modal > div > div:nth-child(1) > div:nth-child(1)', '[data-part=docTitle]', true),
    vIcon: free('#ct-modal > div > div:nth-child(1) > div:nth-child(1) svg', '[data-part=docTitle] svg'),
    vButtons: free('#ct-modal > div > div:nth-child(1) > div:nth-child(2)', '[data-part=docButtons]'),
    vDownload: free('#ct-modal .btn-primary', '[data-part=docDownload]', true),
    vClose: free('#ct-modal .btn-outline', '[data-part=docClose]', true),
    vBody: free('#ct-modal > div > div:nth-child(2)', '[data-part=docBody]'),
    vFrame: free('#ct-preview-frame', '[data-part=docFrame]'),
  });
  return R;
}

// What a state reads (a part that is not there on either side is not compared, one that is on one side only is a failure)
const pageParts = ['ctRoot', 'ctPageHead', 'ctPageTitle', 'ctAdd', 'ctPageBody', 'ctPageHint', 'ctList'];
const tableParts = [
  'ctScroll', 'ctTable', 'ctHeadRow', ...Array.from({ length: COLS }, (_, i) => `ctTh${i + 1}`),
  ...[1, 2, 3].flatMap(r => [`ctRow${r}`, `ctPill${r}`, `ctAuto${r}`, `ctEdit${r}`, `ctPdf${r}`, `ctDelete${r}`, ...Array.from({ length: COLS }, (_, i) => `ctTd${r}${i + 1}`)]),
];
const DIALOG = ['curtain', 'dialog', 'head2', 'sTitle', 'close', 'sBody', 'sFoot', 'cancelBtn', 'save1', 'saveBtn'];
const blockParts = [];
for (const [name, , grids] of BLOCKS) {
  blockParts.push(`ctS_${name}`, `ctBL_${name}`);
  grids.forEach((count, gi) => {
    blockParts.push(`ctG_${name}${gi + 1}`);
    for (let i = 1; i <= count; i++) blockParts.push(`ctF_${name}${gi + 1}_${i}`, `ctC_${name}${gi + 1}_${i}`, `ctI_${name}${gi + 1}_${i}`);
  });
}
const formParts = ['ctForm', ...blockParts, 'ctPair', 'ctPairL1', 'ctPairC1', 'ctPairL2', 'ctPairC2', 'ctExtras', 'ctExtrasHead', 'ctExtrasLbl', 'colsBtn', 'fieldBtn'];
const salePays = ['ctPayBox', 'ctPayCap', 'ctPayList', 'ctPayAdd', ...[1, 2].flatMap(r => [`ctPay${r}`, `ctPayAmount${r}`, `ctPayWhen${r}`, `ctPayDel${r}`])];
const olderParts = ['ctForm', 'ctF_older_6', 'ctI_older_6', ...[3, 4, 5].flatMap(i => [`ctF_older_m${i}`, `ctC_older_m${i}`]), 'ctPayBox',
  ...[1, 2].flatMap(r => [`ctFixed${r}`, `ctFixedAmount${r}`, `ctFixedNote${r}`]), 'ctPair', 'ctPairL1', 'ctPairC1', 'ctPairL2', 'ctPairC2'];
const VIEWER = ['vCurtain', 'vCard', 'vHead', 'vTitle', 'vIcon', 'vButtons', 'vDownload', 'vClose', 'vBody', 'vFrame'];
const LEAD = [...DIALOG, 'ctForm', 'ctPair', 'ctPairL1', 'ctPairC1', 'ctPairL2', 'ctPairC2'];
const READS = {
  ctList: [...pageParts, ...tableParts],
  ctLoading: [...pageParts, 'ctLoading', 'ctSpinner'],
  ctEmpty: [...pageParts, 'ctNone'],
  ctError: [...pageParts, 'ctError'],
  ctForm: [...DIALOG, ...formParts, ...salePays.slice(0, 5), 'ctPay1', 'ctPayAmount1', 'ctPayWhen1', 'ctPayDel1'],
  ctFormEdit: [...DIALOG, ...formParts, ...salePays, 'ctExtrasGrid', 'ctExtraF1', 'ctExtraL1', 'ctExtraC1'],
  ctFormLead: LEAD,
  ctFormError: [...DIALOG, ...formParts, 'ctFormErr'],
  ctFormOlder: [...DIALOG, ...olderParts],
  ctViewer: [...VIEWER],
};
// …and the words that are the server's, not the page's — and so what the length of them decides (how tall the box is)
const NO_WORDS = new Set();
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What the pages hold. Times are far from "now" so they read the same in two pages opened a while apart.
const at = d => new Date(Date.UTC(2026, 8, d, 10, 30)).toISOString();
const SALE = over => ({
  template: 'sale-v2', contractNo: 'MC2610-0001',
  contractDate: { day: 'Wednesday', d: '02', m: '09', y: '2026' },
  company: { name: 'Moto Linkers', commercialReg: '12345', taxId: '678-910', address: 'Alexandria, Egypt', repIn: 'Ahmed Fathy' },
  rep: { name: 'Ahmed Fathy', nationalId: '29001010101010', idDate: '2020-01-01', nationality: 'Egyptian', religion: 'Muslim', address: 'Alexandria', role: 'Managing director' },
  buyer: { name: 'Ali Hassan', nationalId: '28506060606060', idDate: '2019-06-06', nationality: 'Egyptian', religion: 'Muslim', address: '12 Tahrir Street, Cairo' },
  vehicle: { make: 'BYD', model: 'Seal Max', color: 'White / Black', year: '2026', notes: 'Floor mats, charger' },
  total: '1,500,000', totalWords: 'One million five hundred thousand',
  payments: [{ amount: '500,000', when: 'on signing this contract', label: 'deposit' }, { amount: '1,000,000', when: 'on delivery', label: '' }],
  custom_fields: { cf_ref: 'C-77', cf_urgent: true },
  ...over,
});
const OLDER = () => ({
  buyer: { name: 'Mona Said', nationalId: '29909090909090', address: 'Giza' }, vehicle: { make: 'Kia', model: 'Sportage' },
  importCountry: 'China', total: '900,000', totalWords: 'Nine hundred thousand', lateFee: '50', lateFeeWords: 'Fifty', deliveryDeadline: '90 days',
  payments: [{ amount: '100,000', when: 'on signing', label: 'first payment' }, { amount: '800,000', when: 'on delivery' }],
  custom_fields: { cf_ref: 'C-3' },
});
const contracts = () => [
  { id: 1, contract_no: 'MC2610-0001', title: 'عقد — Ali Hassan', status: 'signed', customer_id: 1, deal_id: null, data: SALE(), created_by: 'admin', created_at: at(1), updated_at: at(1) },
  { id: 2, contract_no: 'MC2610-0002', title: 'عقد — Nora Adel', status: 'draft', customer_id: null, deal_id: 3, data: SALE({ contractNo: 'MC2610-0002', buyer: { name: 'Nora Adel' }, custom_fields: { cf_ref: 'C-78' } }), created_by: 'auto_won', created_at: at(3), updated_at: at(3) },
  { id: 3, contract_no: 'MC2610-0003', title: '', status: 'archived', customer_id: null, deal_id: null, data: OLDER(), created_by: 'admin', created_at: null, updated_at: null },
];
const configs = () => [
  { key: 'columns_config:contracts', value: JSON.stringify([
    { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [{ key: 'draft', label: 'Draft', color: '#b9b3a4' }, { key: 'signed', label: 'Signed', color: '#10b981' }, { key: 'cancelled', label: 'Cancelled', color: '#dc2626' }] },
    { key: 'cf_ref', label: 'Reference', type: 'text', builtin: false, visible: true },
    { key: 'cf_urgent', label: 'Urgent', type: 'checkbox', builtin: false, visible: true },
  ]) },
];
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF').toString('base64');

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 4008 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  let stub = null;   // what the server is made to say instead, for the states a real one cannot be put in
  const stubbed = (u, m) => (stub ? stub(u, m) : null);

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const ROLES = rolesFor(p.who);
    const states = Object.keys(READS).filter(s => (!STATE_FILTER.length || STATE_FILTER.includes(s)) && (!['ctViewer', 'ctFormLead'].includes(s) || p.who === 'admin'));
    const reset = () => {
      db.tables.contracts = contracts();
      db.tables.quotation_settings = (db.tables.quotation_settings || []).filter(r => r.key !== 'columns_config:contracts').concat(configs());
      db.failing.clear(); db.latency = 0; stub = null;
    };
    reset();
    const page = await openPage(browser, base, p, mode, next, stubbed);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + '.ai-card,[data-part=aiCard]{display:none!important}' });
    // (a native confirm or prompt would stop the page: the suite answers them)
    await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=list], #contracts-list') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
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
    const open = async () => {
      await go('contracts');
      await until(s => !!document.querySelector(s) && !document.querySelector(s + ' .loading, ' + s + ' [data-part=loading]'), pick(LIST, '[data-part=list]'), 'the list');
    };
    const leave = async () => {
      await go('home');
      await until(s => !document.querySelector(s), pick(PAGE + '.active', '[data-part=docPage]'), 'the page to be left');
    };
    const reopen = async () => { await leave(); await open(); };
    const closeSheet = async () => {
      if (next) { await page.keyboard.press('Escape'); } else { await page.evaluate(() => hideModal()); }
      await gone('#modal-overlay[style*="flex"]', '[data-part=dialog]', 'the dialog to close');
    };
    const addButton = pick(p.who === 'admin' ? `${PAGE} .page-header .btn` : `${PAGE} .btn-primary`, '[data-part=add]');
    const formReady = () => exists('#modal-body #ct-buyer-name, #modal-body .ct-f[data-path="buyer.name"]', '[data-part=dialog] [data-part=docForm] #ct-buyer-name', 'the form');
    const rowButton = (row, n) => pick(`${LIST} tbody tr:nth-child(${row}) td:last-child .btn:nth-of-type(${n})`, `[data-part=list] [data-part=row]:nth-child(${row}) [data-part=${['rowEdit', 'rowExport', 'rowDelete'][n - 1]}]`);

    // the list: the loader first (the server is slow), then the list as it is
    if (states.includes('ctLoading')) {
      db.latency = 1500;
      await go('contracts');
      await exists(`${LIST} .loading`, '[data-part=list] [data-part=loading]', 'the loader');
      await reading('ctLoading');
      db.latency = 0;
      await open();
    } else await open();
    if (states.includes('ctList')) { await exists(`${LIST} tbody tr`, '[data-part=list] [data-part=row]', 'the rows'); await reading('ctList'); }
    // empty, error
    if (states.includes('ctEmpty')) {
      db.tables.contracts = [];
      await reopen();
      await until(s => { const c = document.querySelector(s); return !!c && /No contracts yet/.test(c.textContent); }, pick(LIST, '[data-part=list]'), 'the empty list');
      await reading('ctEmpty');
      reset();
      await reopen();
    }
    if (states.includes('ctError')) {
      db.failing.add('contracts');
      await reopen();
      await exists(`${LIST} .error-msg`, '[data-part=list] [data-part=error]', 'the error');
      await reading('ctError');
      db.failing.clear();
      await reopen();
    }
    // the form, new: as the server starts it, then refused
    if (states.some(s => s === 'ctForm' || s === 'ctFormError')) {
      await click(addButton, addButton);
      await formReady();
      // (what the form asks for after it opens — the leads — has come)
      await sleep(400);
      if (states.includes('ctForm')) await reading('ctForm');
      if (states.includes('ctFormError')) {
        // (the starting form has no buyer: the refusal is the same on both sides)
        await click('#modal-footer .btn-primary', '[data-part=dialog] [data-part=save]');
        await exists('#ct-err[style*="block"]', '[data-part=dialog] [data-part=formError]', 'the refusal');
        await reading('ctFormError');
      }
      await closeSheet();
    }
    // the form, opened on a car-sale contract that has everything
    if (states.includes('ctFormEdit')) {
      await click(rowButton(1, 1), rowButton(1, 1));
      await formReady();
      await sleep(400);
      await reading('ctFormEdit');
      await closeSheet();
    }
    // …with a lead attached
    if (states.includes('ctFormLead')) {
      await click(rowButton(2, 1), rowButton(2, 1));
      await formReady();
      await sleep(400);
      await reading('ctFormLead');
      await closeSheet();
    }
    // …and on one on the older wording
    if (states.includes('ctFormOlder')) {
      await click(rowButton(3, 1), rowButton(3, 1));
      await formReady();
      await sleep(400);
      await reading('ctFormOlder');
      await closeSheet();
    }
    // a contract, as a PDF
    if (states.includes('ctViewer')) {
      stub = (u, m) => (m === 'POST' && /\/contracts\/pdf$/.test(u) ? { status: 200, body: { pdf: PDF, name: 'Contract MC2610-0001' } } : null);
      await click(rowButton(1, 2), rowButton(1, 2));
      await exists('#ct-modal[style*="display: flex"] #ct-preview-frame[src]', '[data-part=docModal] [data-part=docFrame]', 'the viewer');
      await reading('ctViewer');
      await click('#ct-modal .btn-outline', '[data-part=docClose]');
      await gone('#ct-modal[style*="display: flex"]', '[data-part=docModal]', 'the viewer to close');
      stub = null;
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
  const combos = new Set();   // portal/look/mode: each one is read in every state, ~145,000 values
  for (const [key, sides] of Object.entries(observed)) {
    combos.add(key.split('/').slice(0, 3).join('/'));
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const { n, bad } = diff(classic, next, ACCEPTED, stale, PROPS_MORE);
    compared += n;
    if (ABSENT && key.endsWith('/1100')) console.log(`      ${key}: on neither side: ${Object.keys(classic).filter(r => !classic[r] && !next[r]).join(', ') || '—'}`);
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!STATE_FILTER.length) {
    // (CI runs a half per suite, so a half has its own floor: a half that compared nothing, or lost a look, must not pass)
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > combos.size * 115000, `${compared} in ${combos.size} readings`);
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
