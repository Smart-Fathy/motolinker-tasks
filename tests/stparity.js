// The new app's Inventory & Logistics screen against the classic portals', value by value — the same method as tests/ctparity.js (see
// there): the classic page and the new app opened as the same person, in both portals, both colour modes and two looks, at a phone's
// width, two in-betweens and a desktop, and the computed style of every named part compared, and the words in them.
//
// The Models tab:
//   stList       the register in All vehicles: the figures over it (the band, the unmatched-cars notice), the views, and a row for each car
//   stLoading    the server is slow to answer          stEmpty    none yet          stError    the server could not be asked
//   stFilter     the cars narrowed to a status (the Filter button lit, the chip) and grouped by supplier
//   stStatus     By status: a lane for each status        stModel    By model: a card for each, with its cars inside
//   stForm       "Add vehicle", empty                      stFormEdit a model opened for change, with two cars
//   stCsv        the bulk upload (the administrator's)     stCsvPick  Upload with no file chosen                 stCsvDone  a file with a good row and a bad one
// The Tracking tab:
//   tkList       the boxes: a card for each (a box with a voyage, the port calls, a fix on the map; one with none of those)
//   tkLoading    tkEmpty    tkError    as above          tkLookup   a box that is not tracked (no carrier set up)
//   tkMoves      the port calls opened                     tkDiag     Test connection, the key tried every way: a header to set
//   tkDiagRefused  …every header shape refused
//   tkForm       "Track a container", empty                tkFormEdit a box opened for change     tkLink  the sheet that puts a car in a box
//
// What the server says is the server's, and the same on both sides: this is one handler for the two portals, and the classic page and
// the new app ask it the same questions. The map is the place Leaflet would be: a CDN no test reaches, so both pages say it is
// unavailable, in the same words.
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
// what the bulk upload sends: a good row (a model with one car) and a row with no make
const CSV_FILE = path.join(dist, 'vehicles.csv')   // (after the build: it empties its output folder);
fs.writeFileSync(CSV_FILE, 'make,model,trim,price,units,notes\nKia,Sportage,GT,1500000,KIA00000000000001:Black:in_logistics,Fresh in\n,Nameless,Base,100,,\n');

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {};

const role = (c, x, text = false, y = 'abs', rel = 'root') => part(c, x, y, rel, text);
const free = (c, x, text = false) => part(c, x, 'abs', null, text);   // a dialog or a menu floats over the page: its place is the window's

const PAGE = '#page-stock';
const MODELS = '#inv-pane-models';
const TABLE = '#stock-table-container';
const SUM = '#stock-summary';
const XM = '[data-part=modelsPane]';
const XT = '[data-part=register]';
const XS = '[data-part=summary]';

function rolesFor(who) {
  const R = {};
  // the page around the register — each portal's own markup
  if (who === 'admin') {
    Object.assign(R, {
      stRoot: part(PAGE, '[data-part=stockPage]', 'none'),
      stPageHead: role(`${PAGE} .page-header`, '[data-part=pageHead]'),
      stPageTitle: role(`${PAGE} .page-title`, '[data-part=pageTitle]', true),
      stHeadActions: role(`${PAGE} .page-header > div`, '[data-part=headActions]'),
      stCsvBtn: role(`${PAGE} .page-header .btn-outline`, '[data-part=csv]', true),
      stAdd: role('#stock-add-btn', '[data-part=add]', true),
      stBody: role(`${PAGE} > div:not(.page-header):not(.ai-card)`, '[data-part=pageBody]'),
      stTabs: role(`${PAGE} .deal-tabs`, '[data-part=tabs]'),
      stTab1: role(`${PAGE} .deal-tab:nth-child(1)`, '[data-part=tabs] > :nth-child(1)', true),
      stTab2: role(`${PAGE} .deal-tab:nth-child(2)`, '[data-part=tabs] > :nth-child(2)', true),
      stSearch: role('#stock-search', `${XM} > [data-part=input]`),
    });
  } else {
    // (the classic .page is the new app's screen slot, which the shell owns; what the screen draws is the padded body inside it — past
    // the assistant card the classic page puts first)
    Object.assign(R, {
      stPageBody: role(`${PAGE} > div:not(.ai-card)`, '[data-part=stockPage]'),
      stPageHead: role(`${PAGE} > div:not(.ai-card) > div:nth-child(1)`, '[data-part=pageHead]'),
      stPageTitle: role(`${PAGE} .card-title`, '[data-part=pageTitle]', true),
      stPageHint: role(`${PAGE} .card-title + div`, '[data-part=pageHint]', true),
      stHeadActions: role(`${PAGE} > div:not(.ai-card) > div:nth-child(1) > div:nth-child(2)`, '[data-part=headActions]'),
      stSearch: role('#stock-search', '[data-part=headActions] > [data-part=input]'),
      stAdd: role('#stock-add-btn', '[data-part=add]', true),
      stTabs: role(`${PAGE} .tab-strip`, '[data-part=tabs]'),
      stTab1: role(`${PAGE} .tab-strip .tab:nth-child(1)`, '[data-part=tabs] > :nth-child(1)', true),
      stTab2: role(`${PAGE} .tab-strip .tab:nth-child(2)`, '[data-part=tabs] > :nth-child(2)', true),
      stTabIcon1: role(`${PAGE} .tab-strip .tab:nth-child(1) svg`, '[data-part=tabs] > :nth-child(1) svg'),
    });
  }
  Object.assign(R, {
    stModels: role(MODELS, XM),
    stSummary: role(SUM, XS),
    stRegister: role(TABLE, XT),
    stLoading: role(`${TABLE} .loading`, `${XT} [data-part=loading]`, true),
    stSpinner: role(`${TABLE} .spinner`, `${XT} [data-part=loading] > :first-child`),
    stError: role(`${TABLE} .error-msg`, `${XT} [data-part=error]`, true),
    stNone: role(`${TABLE} .stk-none`, `${XT} [data-part=none]`, true),
  });

  // the figures over the register
  const MB = `${SUM} .mix-band`, XB = `${XS} [data-part=mix]`;
  Object.assign(R, {
    mBand: role(MB, XB),
    mTotal: role(`${MB} .mix-total`, `${XB} [data-part=mixTotal]`),
    mCount: role(`${MB} .mix-total .stat-value`, `${XB} [data-part=mixCount]`, true),
    mUnit: role(`${MB} .mix-unit`, `${XB} [data-part=mixUnit]`, true),
    mBody: role(`${MB} .mix-body`, `${XB} [data-part=mixBody]`),
    mBar: role(`${MB} .mix-bar`, `${XB} [data-part=mixBar]`),
    mLegend: role(`${MB} .mix-legend`, `${XB} [data-part=mixLegend]`),
    mSide: role(`${MB} .mix-side`, `${XB} [data-part=mixSide]`),
    mValue: role(`${MB} .mix-side-v`, `${XB} [data-part=mixValue]`, true),
    mLabel: role(`${MB} .mix-side-l`, `${XB} [data-part=mixLabel]`, true),
    mNone: role(`${MB} .stk-none`, `${XB} [data-part=none]`, true),
    nNotice: role(`${SUM} .stk-notice`, `${XS} [data-part=notice]`),
    nIcon: role(`${SUM} .stk-notice svg`, `${XS} [data-part=notice] svg`),
    nText: role(`${SUM} .stk-notice span`, `${XS} [data-part=notice] > span`, true),
    nStrong: role(`${SUM} .stk-notice strong`, `${XS} [data-part=notice] strong`, true),
    nReview: role(`${SUM} .stk-review`, `${XS} [data-part=review]`, true),
  });
  for (let i = 1; i <= 4; i++) {
    R[`mSeg${i}`] = role(`${MB} .mix-bar span:nth-child(${i})`, `${XB} [data-part=mixBar] > :nth-child(${i})`);
    R[`mKey${i}`] = role(`${MB} .mix-key:nth-child(${i})`, `${XB} [data-part=mixKey]:nth-child(${i})`, true);
    R[`mDot${i}`] = role(`${MB} .mix-key:nth-child(${i}) i`, `${XB} [data-part=mixKey]:nth-child(${i}) i`);
    R[`mNum${i}`] = role(`${MB} .mix-key:nth-child(${i}) b`, `${XB} [data-part=mixKey]:nth-child(${i}) b`, true);
  }

  // the views, and what narrows them
  Object.assign(R, {
    vViews: role(`${TABLE} .stk-views`, `${XT} [data-part=views]`),
    vControls: role(`${TABLE} .stk-controls`, `${XT} [data-part=controls]`),
    vFilter: role(`${TABLE} .stk-controls .tbar-btn:nth-child(1)`, `${XT} [data-part=filter]`, true),
    vGroup: role(`${TABLE} .stk-controls .tbar-btn:nth-child(2)`, `${XT} [data-part=groupBy]`, true),
    vChip: role(`${TABLE} .stk-controls .filter-chip`, `${XT} [data-part=chip]`, true),
  });
  for (let i = 1; i <= 3; i++) {
    R[`vTab${i}`] = role(`${TABLE} .stk-views .task-view-tab:nth-child(${i})`, `${XT} [data-part=views] > :nth-child(${i})`, true);
    R[`vTabIcon${i}`] = role(`${TABLE} .stk-views .task-view-tab:nth-child(${i}) svg`, `${XT} [data-part=views] > :nth-child(${i}) svg`);
  }

  // All vehicles
  const TC = `${TABLE} .table-card`, TT = `${TABLE} table`, XC = `${XT} [data-part=unitCard]`, XTT = `${XT} [data-part=unitTable]`;
  Object.assign(R, {
    tCard: role(TC, XC),
    tTable: role(TT, XTT),
    tHeadRow: role(`${TT} thead tr`, `${XTT} thead tr`),
    tGroup: role(`${TABLE} .stk-group`, `${XT} [data-part=supplierGroup]`),
    tGroupHead: role(`${TABLE} .stk-group-head`, `${XT} [data-part=supplierHead]`, true),
    tGroupN: role(`${TABLE} .stk-group-n`, `${XT} [data-part=supplierHead] > span`, true),
  });
  for (let c = 1; c <= 10; c++) R[`tTh${c}`] = role(`${TT} thead th:nth-child(${c})`, `${XTT} thead th:nth-child(${c})`, true);
  for (const r of [1, 2, 3]) {
    const T = `${TT} tbody tr:nth-child(${r})`, X = `${XTT} tbody tr:nth-child(${r})`;
    R[`tRow${r}`] = role(T, X);
    for (let c = 1; c <= 10; c++) R[`tTd${r}_${c}`] = role(`${T} td:nth-child(${c})`, `${X} td:nth-child(${c})`, true);
    R[`tVeh${r}`] = role(`${T} .stk-veh`, `${X} [data-part=veh]`, true);
    R[`tTrim${r}`] = role(`${T} .stk-trim`, `${X} [data-part=vtrim]`, true);
    R[`tPill${r}`] = role(`${T} .stk-pill`, `${X} [data-part=pill]`, true);
    R[`tColour${r}`] = role(`${T} .stk-col`, `${X} td:nth-child(3) > span`, true);
    R[`tSwatch${r}`] = role(`${T} .stk-col i`, `${X} td:nth-child(3) > span > i`);
    R[`tEdit${r}`] = role(`${T} .stk-edit`, `${X} [data-part=rowEdit]`, true);
  }

  // By status
  const BD = `${TABLE} .lead-board`, XBD = `${XT} [data-part=board]`;
  R.sBoard = role(BD, XBD);
  for (const l of [1, 2, 3, 4]) {
    const L = `${BD} .lb-col:nth-child(${l})`, XL = `${XBD} [data-part=lane]:nth-child(${l})`;
    Object.assign(R, {
      [`sLane${l}`]: role(L, XL),
      [`sHead${l}`]: role(`${L} .lb-head`, `${XL} [data-part=laneHead]`),
      [`sTop${l}`]: role(`${L} .lb-head-top`, `${XL} [data-part=laneHead] > :first-child`),
      [`sPill${l}`]: role(`${L} .stk-pill`, `${XL} [data-part=pill]`, true),
      [`sN${l}`]: role(`${L} .lb-n`, `${XL} [data-part=laneN]`, true),
      [`sVal${l}`]: role(`${L} .lb-val`, `${XL} [data-part=laneVal]`, true),
      [`sShare${l}`]: role(`${L} .lb-share`, `${XL} [data-part=laneShare]`, true),
      [`sBody${l}`]: role(`${L} .lb-body`, `${XL} [data-part=laneBody]`),
      [`sNone${l}`]: role(`${L} .stk-none`, `${XL} [data-part=none]`, true),
      [`sCard${l}`]: role(`${L} .lb-card`, `${XL} [data-part=laneCard]`),
      [`sName${l}`]: role(`${L} .lb-name`, `${XL} [data-part=laneName]`, true),
      [`sMeta${l}`]: role(`${L} .lb-meta`, `${XL} [data-part=laneMeta]`, true),
      [`sBudget${l}`]: role(`${L} .lb-budget`, `${XL} [data-part=laneBudget]`, true),
      [`sFoot${l}`]: role(`${L} .lb-foot`, `${XL} [data-part=laneFoot]`, true),
    });
  }

  // By model
  const GR = `${TABLE} .stock-grid`, XG = `${XT} [data-part=modelGrid]`;
  R.cGrid = role(GR, XG);
  for (const c of [1, 2, 3]) {
    const K = `${GR} .stock-card:nth-child(${c})`, XK = `${XG} [data-part=modelCard]:nth-child(${c})`;
    Object.assign(R, {
      [`cCard${c}`]: role(K, XK),
      [`cHead${c}`]: role(`${K} .stock-card-head`, `${XK} [data-part=modelHead]`),
      [`cTitle${c}`]: role(`${K} .stock-title`, `${XK} [data-part=modelTitle]`, true),
      [`cTrim${c}`]: role(`${K} .stock-trim`, `${XK} [data-part=modelTrim]`, true),
      [`cQty${c}`]: role(`${K} .stock-qty`, `${XK} [data-part=qty]`, true),
      [`cPrice${c}`]: role(`${K} .stock-price`, `${XK} [data-part=modelPrice]`, true),
      [`cSec${c}`]: role(`${K} .stock-sec`, `${XK} [data-part=modelSec]`),
      [`cSecLabel${c}`]: role(`${K} .stock-sec-label`, `${XK} [data-part=secLabel]`, true),
      [`cScroll${c}`]: role(`${K} .stock-sec .table-scroll`, `${XK} [data-part=cardScroll]`),
      [`cUnits${c}`]: role(`${K} .stock-units`, `${XK} [data-part=cardUnits]`),
      [`cUh${c}`]: role(`${K} .stock-units thead th:nth-child(1)`, `${XK} [data-part=cardUnits] thead th:nth-child(1)`, true),
      [`cUh5${c}`]: role(`${K} .stock-units thead th:nth-child(5)`, `${XK} [data-part=cardUnits] thead th:nth-child(5)`, true),
      [`cUd${c}`]: role(`${K} .stock-units tbody td:nth-child(3)`, `${XK} [data-part=cardUnits] tbody td:nth-child(3)`, true),
      [`cUd5${c}`]: role(`${K} .stock-units tbody td:nth-child(5)`, `${XK} [data-part=cardUnits] tbody td:nth-child(5)`, true),
      [`cLegacy${c}`]: role(`${K} .stk-legacy`, `${XK} [data-part=legacyNote]`, true),
      [`cNotes${c}`]: role(`${K} .stock-notes`, `${XK} [data-part=notes]`, true),
      [`cActions${c}`]: role(`${K} .stock-actions`, `${XK} [data-part=modelActions]`),
      [`cEdit${c}`]: role(`${K} .stock-actions .btn:nth-child(1)`, `${XK} [data-part=cardEdit]`, true),
      [`cDelete${c}`]: role(`${K} .stock-actions .btn:nth-child(2)`, `${XK} [data-part=cardDelete]`, true),
    });
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
    saveBtn: free('#modal-footer .btn:nth-child(2)', `${D}> [data-part=foot] > :nth-child(2)`, true),
  });

  // the model's form
  const F = '#modal-body > div:first-child', XF = `${D}[data-part=form]`;
  Object.assign(R, {
    fForm: free(F, XF),
    fPair: free(`${F} > :nth-child(1)`, `${XF} > :nth-child(1)`),
    fMakeL: free(`${F} > :nth-child(1) > :nth-child(1) > label`, `${XF} > :nth-child(1) > :nth-child(1) > label`, true),
    fMake: free('#stk-make', '#stk-make'),
    fModelL: free(`${F} > :nth-child(1) > :nth-child(2) > label`, `${XF} > :nth-child(1) > :nth-child(2) > label`, true),
    fModel: free('#stk-model', '#stk-model'),
    fTrimL: free(`${F} > :nth-child(2) > label`, `${XF} > :nth-child(2) > label`, true),
    fTrim: free('#stk-trim', '#stk-trim'),
    fPriceL: free(`${F} > :nth-child(3) > label`, `${XF} > :nth-child(3) > label`, true),
    fPrice: free('#stk-price', '#stk-price'),
    fUnitsL: free(`${F} > :nth-child(4) > label`, `${XF} > :nth-child(4) > label`, true),
    fUnitsHint: free(`${F} > :nth-child(4) > label span`, `${XF} > :nth-child(4) > label span`, true),
    fFrame: free(`${F} > :nth-child(4) > div`, `${XF} [data-part=gridFrame]`),
    fGrid: free(`${F} > :nth-child(4) > div > table`, `${XF} [data-part=grid]`),
    fAddUnit: free(`${F} > :nth-child(4) > .btn`, `${XF} [data-part=addUnit]`, true),
    fColsBtn: free(`${F} > :nth-child(4) .btn[onclick*="openPicker"]`, `${XF} [data-part=colsButton]`, true),
    fFieldBtn: free(`${F} > :nth-child(4) .btn[onclick*="openAddModal"]`, `${XF} [data-part=fieldButton]`, true),
    fHint: free(`${F} > :nth-child(4) > div:last-of-type`, `${XF} [data-part=rowsHint]`, true),
    fNotesL: free(`${F} > :nth-child(5) > label`, `${XF} > :nth-child(5) > label`, true),
    fNotes: free('#stk-notes', '#stk-notes'),
    fErr: free('#stk-err', `${XF} [data-part=formError]`, true),
    fNumHead: free(`${F} thead th:nth-child(1)`, `${XF} [data-part=gridNumberHead]`, true),
    fHead1: free(`${F} thead th:nth-child(2)`, `${XF} thead th:nth-child(2)`, true),
    fHead4: free(`${F} thead th:nth-child(5)`, `${XF} thead th:nth-child(5)`, true),
    fEndHead: free(`${F} thead th:last-child`, `${XF} [data-part=gridEndHead]`),
  });
  for (const r of [1, 2]) {
    const T = `${F} tbody tr:nth-child(${r})`, X = `${XF} [data-part=gridRow]:nth-child(${r})`;
    Object.assign(R, {
      [`fRow${r}`]: free(T, X),
      [`fNo${r}`]: free(`${T} td:nth-child(1)`, `${X} [data-part=gridNumber]`, true),
      [`fCell${r}_1`]: free(`${T} td:nth-child(2)`, `${X} [data-part=gridCell]:nth-child(2)`),
      [`fIn${r}_1`]: free(`${T} td:nth-child(2) input`, `${X} [data-part=gridCell]:nth-child(2) input`),
      [`fCell${r}_4`]: free(`${T} td:nth-child(5)`, `${X} [data-part=gridCell]:nth-child(5)`),
      [`fSel${r}`]: free(`${T} td:nth-child(5) .bselect-trigger`, `${X} [data-part=gridSelect]`, true),
      [`fCell${r}_5`]: free(`${T} td:nth-child(6)`, `${X} [data-part=gridCell]:nth-child(6)`),
      [`fIn${r}_5`]: free(`${T} td:nth-child(6) input`, `${X} [data-part=gridCell]:nth-child(6) input`),
      [`fEnd${r}`]: free(`${T} td:last-child`, `${X} [data-part=gridEnd]`),
      [`fDel${r}`]: free(`${T} td:last-child .btn`, `${X} [data-part=gridRemove]`, true),
    });
  }
  // the bulk upload (the administrator's)
  if (who === 'admin') {
    const C = '#modal-body > div:first-child', XC = `${D}[data-part=csvForm]`;
    Object.assign(R, {
      csvForm: free(C, XC),
      csvP1: free(`${C} > p:nth-child(1)`, `${XC} > p:nth-child(1)`, true),
      csvStrong: free(`${C} > p:nth-child(1) strong`, `${XC} > p:nth-child(1) strong`, true),
      csvP2: free(`${C} > p:nth-child(2)`, `${XC} > p:nth-child(2)`, true),
      csvCode: free(`${C} > p:nth-child(2) code`, `${XC} > p:nth-child(2) code`, true),
      csvTemplate: free(`${C} > a.btn`, `${XC} [data-part=template]`, true),
      csvTemplateIcon: free(`${C} > a.btn svg`, `${XC} [data-part=template] svg`),
      csvFile: free('#stock-csv-file', `${XC} [data-part=csvFile]`),
      csvResult: free('#stock-csv-result', `${XC} [data-part=csvResult]`),
      csvErr: free('#stock-csv-result .error-msg', `${XC} [data-part=csvResult] [role=alert]`, true),
      csvDone: free('#stock-csv-result > div', `${XC} [data-part=csvResult] > div`, true),
      csvDoneN: free('#stock-csv-result > div strong', `${XC} [data-part=csvResult] > div strong`, true),
      csvWarn: free('#stock-csv-result > div span', `${XC} [data-part=csvResult] > div span`, true),
      csvUpload: free('#modal-footer .btn-primary', `${D}> [data-part=foot] > [data-part=upload]`, true),
    });
  }

  // the Tracking tab: logistics.js draws it into both portals, so it is one markup; the page around it is each portal's
  const TP = '#inv-pane-tracking', XTP = '[data-part=trackingPane]';
  const LB = `${TP} .logi-bar`, XLB = `${XTP} [data-part=bar]`;
  const LC = '#logi-containers', XLC = `${XTP} [data-part=containers]`;
  const LR = '#logi-ct-result', XLR = `${XTP} [data-part=result]`;
  Object.assign(R, {
    tkPane: role(TP, XTP),
    tkBar: role(LB, XLB),
    tkInput: role('#logi-ct-search', '#logi-ct-search'),
    tkTrack: role(`${LB} > button:nth-child(2)`, `${XLB} [data-part=track]`, true),
    tkTrackIcon: role(`${LB} > button:nth-child(2) svg`, `${XLB} [data-part=track] svg`),
    tkAdd: role(`${LB} > button:nth-child(3)`, `${XLB} [data-part=addBox]`, true),
    tkAddIcon: role(`${LB} > button:nth-child(3) svg`, `${XLB} [data-part=addBox] svg`),
    tkCheck: role(`${LB} > button:nth-child(4)`, `${XLB} [data-part=check]`, true),
    tkCheckIcon: role(`${LB} > button:nth-child(4) svg`, `${XLB} [data-part=check] svg`),
    tkResult: role(LR, XLR),
    tkBoard: role(LC, XLC),
    tkLoadingBox: role(`${LC} .loading`, `${XLC} [data-part=loading]`, true),
    tkSpinner: role(`${LC} .spinner`, `${XLC} [data-part=loading] > :first-child`),
    tkError: role(`${LC} .error-msg`, `${XLC} [data-part=error]`, true),
    tkNothing: role(`${LC} .logi-empty`, `${XLC} [data-part=nothing]`, true),
    tkGrid: role(`${LC} .logi-ct-grid`, `${XLC} [data-part=board]`),
    // a lookup's answer, under the buttons
    tkLkLoading: role(`${LR} .loading`, `${XLR} [data-part=loading]`, true),
    tkLkError: role(`${LR} .error-msg`, `${XLR} [data-part=resultError]`, true),
    tkLkEmpty: role(`${LR} .logi-empty`, `${XLR} [data-part=notTracked]`),
    tkLkHead: role(`${LR} .logi-empty > div:nth-child(1)`, `${XLR} [data-part=notTrackedHead]`, true),
    tkLkWhy: role(`${LR} .logi-empty > div:nth-child(2)`, `${XLR} [data-part=why]`, true),
    tkLkActions: role(`${LR} .logi-empty > div:nth-child(3)`, `${XLR} [data-part=notTrackedActions]`),
    tkLkStart: role(`${LR} .logi-empty .btn-primary`, `${XLR} [data-part=start]`, true),
    tkLkWarn: role(`${LR} .logi-warn`, `${XLR} [data-part=checkWarn]`, true),
    // what the server found trying the carrier's key every way, under the buttons
    dgBox: role(`${LR} .logi-empty`, `${XLR} [data-part=diagnosis]`),
    dgHead: role(`${LR} .logi-empty > div:nth-child(1)`, `${XLR} [data-part=diagnosis] > div:nth-child(1)`, true),
    dgHeadIcon: role(`${LR} .logi-empty > div:nth-child(1) svg`, `${XLR} [data-part=diagnosis] > div:nth-child(1) svg`),
    dg2: role(`${LR} .logi-empty > div:nth-child(2)`, `${XLR} [data-part=diagnosis] > div:nth-child(2)`, true),
    dg3: role(`${LR} .logi-empty > div:nth-child(3)`, `${XLR} [data-part=diagnosis] > div:nth-child(3)`, true),
    dgCode: role(`${LR} .logi-empty > div:nth-child(2) code`, `${XLR} [data-part=diagnosis] > div:nth-child(2) code`, true),
    dgPre: role(`${LR} .logi-empty > pre`, `${XLR} [data-part=diagnosis] > pre`, true),
    dgBase: role(`${LR} .logi-empty > div:nth-child(5)`, `${XLR} [data-part=diagnosis] > div:nth-child(5)`, true),
    dgBaseCode: role(`${LR} .logi-empty > div:nth-child(5) code`, `${XLR} [data-part=diagnosis] > div:nth-child(5) code`, true),
    dgList: role(`${LR} .logi-empty > ul`, `${XLR} [data-part=diagnosis] > ul`),
    dgLi1: role(`${LR} .logi-empty > ul > li:nth-child(1)`, `${XLR} [data-part=diagnosis] > ul > li:nth-child(1)`, true),
    dgLi2: role(`${LR} .logi-empty > ul > li:nth-child(2)`, `${XLR} [data-part=diagnosis] > ul > li:nth-child(2)`, true),
    dgLiCode: role(`${LR} .logi-empty > ul > li:nth-child(1) code`, `${XLR} [data-part=diagnosis] > ul > li:nth-child(1) code`, true),
  });
  for (const c of [1, 2]) {
    const K = `${LC} .logi-ct:nth-child(${c})`, XK = `${XLC} [data-part=container]:nth-child(${c})`;
    Object.assign(R, {
      [`tkCard${c}`]: role(K, XK),
      [`tkBody${c}`]: role(`${K} .logi-ct-body`, `${XK} [data-part=ctBody]`),
      [`tkHead${c}`]: role(`${K} .logi-ct-body > div:nth-child(1)`, `${XK} [data-part=ctHead]`),
      [`tkPill${c}`]: role(`${K} .logi-pill`, `${XK} [data-part=ctStatus]`, true),
      [`tkCarrier${c}`]: role(`${K} .logi-ct-body > div:nth-child(1) > span:nth-child(2)`, `${XK} [data-part=carrier]`, true),
      [`tkWarn${c}`]: role(`${K} .logi-ct-body .logi-warn`, `${XK} [data-part=ctBody] [data-part=checkWarn]`, true),
      [`tkVoy${c}`]: role(`${K} .logi-voy`, `${XK} [data-part=voyage]`),
      [`tkVoyNone${c}`]: role(`${K} .logi-voy-none`, `${XK} [data-part=voyNone]`, true),
      [`tkVoyShip${c}`]: role(`${K} .logi-voy-ship`, `${XK} [data-part=voyShip]`),
      [`tkVoyName${c}`]: role(`${K} .logi-voy-name`, `${XK} [data-part=voyName]`, true),
      [`tkVoyImo${c}`]: role(`${K} .logi-voy-imo`, `${XK} [data-part=voyImo]`, true),
      [`tkVoyEnds${c}`]: role(`${K} .logi-voy-ends`, `${XK} [data-part=voyEnds]`),
      [`tkVoyFrom${c}`]: role(`${K} .logi-voy-ends > span:nth-child(1)`, `${XK} [data-part=voyEnds] > span:nth-child(1)`, true),
      [`tkVoyTo${c}`]: role(`${K} .logi-voy-ends > span:nth-child(2)`, `${XK} [data-part=voyEnds] > span:nth-child(2)`, true),
      [`tkVoyCodes${c}`]: role(`${K} .logi-voy-codes`, `${XK} [data-part=voyCodes]`, true),
      [`tkVoyTrack${c}`]: role(`${K} .logi-voy-track`, `${XK} [data-part=voyTrack]`),
      [`tkVoyLine${c}`]: role(`${K} .logi-voy-line`, `${XK} [data-part=voyLine]`),
      [`tkVoyDone${c}`]: role(`${K} .logi-voy-done`, `${XK} [data-part=voyDone]`),
      [`tkVoyDot${c}`]: role(`${K} .logi-voy-dot`, `${XK} [data-part=voyDot]`),
      [`tkVoyShipIc${c}`]: role(`${K} .logi-voy-ship-ic`, `${XK} [data-part=voyShipIc]`),
      [`tkVoyEnd${c}`]: role(`${K} .logi-voy-end`, `${XK} [data-part=voyEnd]`),
      [`tkVoyTimes${c}`]: role(`${K} .logi-voy-times`, `${XK} [data-part=voyTimes]`, true),
      [`tkVoyTime1_${c}`]: role(`${K} .logi-voy-times > span:nth-child(1)`, `${XK} [data-part=voyTimes] > span:nth-child(1)`, true),
      [`tkVoyTime2_${c}`]: role(`${K} .logi-voy-times > span:nth-child(2)`, `${XK} [data-part=voyTimes] > span:nth-child(2)`, true),
      [`tkMoves${c}`]: role(`${K} .logi-moves`, `${XK} [data-part=moves]`),
      [`tkMovesSum${c}`]: role(`${K} .logi-moves > summary`, `${XK} [data-part=moves] > summary`, true),
      [`tkMovesN${c}`]: role(`${K} .logi-moves > summary > span`, `${XK} [data-part=moves] > summary > span`, true),
      [`tkMovesList${c}`]: role(`${K} .logi-moves > ul`, `${XK} [data-part=moves] > ul`),
      [`tkPos${c}`]: role(`${K} .logi-pos`, `${XK} [data-part=position]`),
      [`tkPosHead${c}`]: role(`${K} .logi-pos-head`, `${XK} [data-part=posHead]`),
      [`tkPosCo${c}`]: role(`${K} .logi-pos-co`, `${XK} [data-part=posCo]`, true),
      [`tkPosAge${c}`]: role(`${K} .logi-pos-age`, `${XK} [data-part=posAge]`, true),
      [`tkMapFb${c}`]: role(`${K} .logi-map-fallback`, `${XK} [data-part=mapFallback]`, true),
      [`tkMapLink${c}`]: role(`${K} .logi-map-fallback a`, `${XK} [data-part=mapFallback] a`, true),
      [`tkFoot${c}`]: role(`${K} .logi-ct-foot`, `${XK} [data-part=ctFoot]`),
      [`tkEta${c}`]: role(`${K} .logi-ct-foot .logi-ct-row`, `${XK} [data-part=ctFoot] [data-part=ctRow]`),
      [`tkEtaV${c}`]: role(`${K} .logi-ct-foot .logi-ct-v`, `${XK} [data-part=ctFoot] [data-part=ctValue]`, true),
      [`tkActions${c}`]: role(`${K} .logi-ct-actions`, `${XK} [data-part=ctActions]`),
      [`tkRefresh${c}`]: role(`${K} .logi-ct-actions > :nth-child(1)`, `${XK} [data-part=refresh]`),
      [`tkEdit${c}`]: role(`${K} .logi-ct-actions > :nth-child(2)`, `${XK} [data-part=edit]`),
      [`tkUnits${c}`]: role(`${K} .logi-units`, `${XK} [data-part=cars]`),
      [`tkUnitsLabel${c}`]: role(`${K} .logi-units > span:first-child`, `${XK} [data-part=carsLabel]`, true),
      [`tkChip${c}`]: role(`${K} .logi-unit-chip`, `${XK} [data-part=car]`, true),
      [`tkChipX${c}`]: role(`${K} .logi-unit-chip button`, `${XK} [data-part=unlink]`, true),
      [`tkLink${c}`]: role(`${K} .logi-units > .btn`, `${XK} [data-part=link]`, true),
    });
    for (const r of [1, 2, 3]) {
      const T = `${K} .logi-ct-body > .logi-ct-row:nth-child(${r + 1})`, X = `${XK} [data-part=ctBody] > [data-part=ctRow]:nth-child(${r + 1})`;
      Object.assign(R, {
        [`tkRow${c}_${r}`]: role(T, X),
        [`tkIc${c}_${r}`]: role(`${T} .logi-ct-ic`, `${X} > :nth-child(1)`),
        [`tkK${c}_${r}`]: role(`${T} .logi-ct-k`, `${X} > :nth-child(2) > :nth-child(1)`, true),
        [`tkV${c}_${r}`]: role(`${T} .logi-ct-v`, `${X} [data-part=ctValue]`, true),
      });
    }
    for (const m of [1, 2]) {
      const T = `${K} .logi-moves li:nth-child(${m})`, X = `${XK} [data-part=moves] [data-part=move]:nth-child(${m})`;
      Object.assign(R, {
        [`tkMove${c}_${m}`]: role(T, X),
        [`tkMoveAt${c}_${m}`]: role(`${T} .logi-move-at`, `${X} > :nth-child(1)`, true),
        [`tkMoveWhat${c}_${m}`]: role(`${T} .logi-move-what`, `${X} > :nth-child(2)`, true),
        [`tkMoveEm${c}_${m}`]: role(`${T} .logi-move-what em`, `${X} > :nth-child(2) em`, true),
        [`tkMoveWhere${c}_${m}`]: role(`${T} .logi-move-where`, `${X} > :nth-child(3)`, true),
      });
    }
  }

  // the box's form, and the sheet that puts a car in a box
  const BODY = '#modal-body', XBODY = `${D}> [data-part=body]`;
  Object.assign(R, {
    tfGrid1: free(`${BODY} > :nth-child(1)`, `${XBODY} > :nth-child(1)`),
    tfHeading: free(`${BODY} > :nth-child(2)`, `${XBODY} > :nth-child(2)`, true),
    tfHint: free(`${BODY} > :nth-child(3)`, `${XBODY} > :nth-child(3)`, true),
    tfGrid2: free(`${BODY} > :nth-child(4)`, `${XBODY} > :nth-child(4)`),
    tfNotesG: free(`${BODY} > :nth-child(5)`, `${XBODY} > :nth-child(5)`),
    tfNotesL: free(`${BODY} > :nth-child(5) > label`, `${XBODY} > :nth-child(5) > label`, true),
    tfNotes: free('#ct-notes', `${XBODY} > :nth-child(5) > textarea`),
    tfErr: free('#ct-err', `${XBODY} [data-part=formError]`, true),
    tfCancel: free('#modal-footer .btn:nth-child(1)', `${D}> [data-part=foot] > [data-part=cancel]`, true),
    tfDelete: free('#modal-footer .btn[onclick^="deleteContainer"]', `${D}> [data-part=foot] > [data-part=delete]`, true),
    tfSave: free('#modal-footer .btn-primary', `${D}> [data-part=foot] > [data-part=save]`, true),
    lkGroup: free(`${BODY} > :nth-child(1)`, `${XBODY} > :nth-child(1)`),
    lkLabel: free(`${BODY} > :nth-child(1) > label`, `${XBODY} > :nth-child(1) > label`, true),
    lkSelect: free(`${BODY} > :nth-child(1) .bselect-trigger`, `${XBODY} [data-part=carPick]`, true),
    lkHint: free(`${BODY} > :nth-child(2)`, `${XBODY} > :nth-child(2)`, true),
    lkAdd: free('#modal-footer .btn-primary', `${D}> [data-part=foot] > [data-part=add]`, true),
  });
  for (let i = 1; i <= 15; i++) {
    const G = `${BODY} > :nth-child(1) > :nth-child(${i})`, XG = `${XBODY} > :nth-child(1) > :nth-child(${i})`;
    const pick = i === 2 ? ['.bselect-trigger', '[data-part=ctType]'] : i === 3 ? ['.bselect-trigger', '[data-part=ctStatus]'] : ['input', 'input'];
    Object.assign(R, {
      [`tfG${i}`]: free(G, XG),
      [`tfL${i}`]: free(`${G} > label`, `${XG} > label`, true),
      [`tfC${i}`]: free(`${G} ${pick[0]}`, `${XG} ${pick[1]}`, true),
    });
  }
  for (let i = 1; i <= 6; i++) {
    const G = `${BODY} > :nth-child(4) > :nth-child(${i})`, XG = `${XBODY} > :nth-child(4) > :nth-child(${i})`;
    Object.assign(R, {
      [`tpG${i}`]: free(G, XG),
      [`tpL${i}`]: free(`${G} > label`, `${XG} > label`, true),
      [`tpC${i}`]: free(`${G} input`, `${XG} input`, true),
    });
  }
  return R;
}

// What a state reads (a part that is not there on either side is not compared, one that is on one side only is a failure)
const pageParts = ['stRoot', 'stPageHead', 'stPageTitle', 'stPageHint', 'stPageBody', 'stHeadActions', 'stCsvBtn', 'stAdd', 'stBody', 'stSearch', 'stTabs', 'stTab1', 'stTab2', 'stTabIcon1', 'stModels', 'stSummary', 'stRegister'];
const bandParts = ['mBand', 'mTotal', 'mCount', 'mUnit', 'mBody', 'mBar', 'mLegend', 'mSide', 'mValue', 'mLabel', ...[1, 2, 3, 4].flatMap(i => [`mSeg${i}`, `mKey${i}`, `mDot${i}`, `mNum${i}`]), 'nNotice', 'nIcon', 'nText', 'nStrong', 'nReview'];
const viewParts = ['vViews', 'vControls', 'vFilter', 'vGroup', 'vChip', ...[1, 2, 3].flatMap(i => [`vTab${i}`, `vTabIcon${i}`])];
const tableParts = ['tCard', 'tTable', 'tHeadRow', ...Array.from({ length: 10 }, (_, i) => `tTh${i + 1}`),
  ...[1, 2, 3].flatMap(r => [`tRow${r}`, `tVeh${r}`, `tTrim${r}`, `tPill${r}`, `tColour${r}`, `tSwatch${r}`, `tEdit${r}`, ...Array.from({ length: 10 }, (_, i) => `tTd${r}_${i + 1}`)])];
const boardParts = ['sBoard', ...[1, 2, 3, 4].flatMap(l => [`sLane${l}`, `sHead${l}`, `sTop${l}`, `sPill${l}`, `sN${l}`, `sVal${l}`, `sShare${l}`, `sBody${l}`, `sNone${l}`, `sCard${l}`, `sName${l}`, `sMeta${l}`, `sBudget${l}`, `sFoot${l}`])];
const cardParts = ['cGrid', ...[1, 2, 3].flatMap(c => [`cCard${c}`, `cHead${c}`, `cTitle${c}`, `cTrim${c}`, `cQty${c}`, `cPrice${c}`, `cSec${c}`, `cSecLabel${c}`, `cScroll${c}`, `cUnits${c}`, `cUh${c}`, `cUh5${c}`, `cUd${c}`, `cUd5${c}`, `cLegacy${c}`, `cNotes${c}`, `cActions${c}`, `cEdit${c}`, `cDelete${c}`])];
const DIALOG = ['curtain', 'dialog', 'head2', 'sTitle', 'close', 'sBody', 'sFoot', 'cancelBtn', 'saveBtn'];
const formParts = ['fForm', 'fPair', 'fMakeL', 'fMake', 'fModelL', 'fModel', 'fTrimL', 'fTrim', 'fPriceL', 'fPrice', 'fUnitsL', 'fUnitsHint', 'fFrame', 'fGrid', 'fAddUnit', 'fColsBtn', 'fFieldBtn', 'fHint', 'fNotesL', 'fNotes', 'fErr',
  'fNumHead', 'fHead1', 'fHead4', 'fEndHead', ...[1, 2].flatMap(r => [`fRow${r}`, `fNo${r}`, `fCell${r}_1`, `fIn${r}_1`, `fCell${r}_4`, `fSel${r}`, `fCell${r}_5`, `fIn${r}_5`, `fEnd${r}`, `fDel${r}`])];
const csvParts = ['csvForm', 'csvP1', 'csvStrong', 'csvP2', 'csvCode', 'csvTemplate', 'csvTemplateIcon', 'csvFile', 'csvResult', 'csvUpload'];
const tkPage = ['stTabs', 'stTab1', 'stTab2', 'tkPane', 'tkBar', 'tkInput', 'tkTrack', 'tkTrackIcon', 'tkAdd', 'tkAddIcon', 'tkCheck', 'tkCheckIcon', 'tkResult', 'tkBoard'];
const tkRowParts = c => [1, 2, 3].flatMap(r => [`tkRow${c}_${r}`, `tkIc${c}_${r}`, `tkK${c}_${r}`, `tkV${c}_${r}`]);
const tkCardParts = c => [`tkCard${c}`, `tkBody${c}`, `tkHead${c}`, `tkPill${c}`, `tkCarrier${c}`, ...tkRowParts(c), `tkWarn${c}`,
  `tkVoy${c}`, `tkVoyNone${c}`, `tkVoyShip${c}`, `tkVoyName${c}`, `tkVoyImo${c}`, `tkVoyEnds${c}`, `tkVoyFrom${c}`, `tkVoyTo${c}`, `tkVoyCodes${c}`, `tkVoyTrack${c}`, `tkVoyLine${c}`,
  `tkVoyDone${c}`, `tkVoyDot${c}`, `tkVoyShipIc${c}`, `tkVoyEnd${c}`, `tkVoyTimes${c}`, `tkVoyTime1_${c}`, `tkVoyTime2_${c}`,
  `tkMoves${c}`, `tkMovesSum${c}`, `tkMovesN${c}`, `tkPos${c}`, `tkPosHead${c}`, `tkPosCo${c}`, `tkPosAge${c}`, `tkMapFb${c}`, `tkMapLink${c}`,
  `tkFoot${c}`, `tkEta${c}`, `tkEtaV${c}`, `tkActions${c}`, `tkRefresh${c}`, `tkEdit${c}`, `tkUnits${c}`, `tkUnitsLabel${c}`, `tkChip${c}`, `tkChipX${c}`, `tkLink${c}`];
const tkMoveParts = c => [`tkMovesList${c}`, ...[1, 2].flatMap(m => [`tkMove${c}_${m}`, `tkMoveAt${c}_${m}`, `tkMoveWhat${c}_${m}`, `tkMoveEm${c}_${m}`, `tkMoveWhere${c}_${m}`])];
const tkFormParts = [...DIALOG, 'tfGrid1', 'tfHeading', 'tfHint', 'tfGrid2', 'tfNotesG', 'tfNotesL', 'tfNotes', 'tfErr', 'tfCancel', 'tfDelete', 'tfSave',
  ...Array.from({ length: 15 }, (_, i) => [`tfG${i + 1}`, `tfL${i + 1}`, `tfC${i + 1}`]).flat(),
  ...Array.from({ length: 6 }, (_, i) => [`tpG${i + 1}`, `tpL${i + 1}`, `tpC${i + 1}`]).flat()];
const READS = {
  stList: [...pageParts, ...bandParts, ...viewParts, ...tableParts],
  stLoading: [...pageParts, 'stLoading', 'stSpinner'],
  stEmpty: [...pageParts, 'mBand', 'mCount', 'mUnit', 'mNone', 'mValue', 'mLabel', ...viewParts, 'stNone'],
  stError: [...pageParts, 'stError'],
  stFilter: [...pageParts, ...viewParts, 'tGroup', 'tGroupHead', 'tGroupN', ...tableParts],
  stStatus: [...pageParts, ...viewParts, ...boardParts],
  stModel: [...pageParts, ...viewParts, ...cardParts],
  stForm: [...DIALOG, ...formParts],
  stFormEdit: [...DIALOG, ...formParts],
  stCsv: [...DIALOG, ...csvParts],
  stCsvPick: [...DIALOG, 'csvResult', 'csvErr'],
  stCsvDone: [...DIALOG, 'csvResult', 'csvDone', 'csvDoneN', 'csvWarn'],
  tkError: [...tkPage, 'tkBoard', 'tkError'],
  tkLoading: [...tkPage, 'tkLoadingBox', 'tkSpinner'],
  tkEmpty: [...tkPage, 'tkNothing'],
  tkList: [...tkPage, 'tkGrid', ...tkCardParts(1), ...tkCardParts(2)],
  tkMoves: [...tkPage, 'tkGrid', 'tkMoves1', 'tkMovesSum1', ...tkMoveParts(1)],
  tkLookup: [...tkPage, 'tkLkEmpty', 'tkLkHead', 'tkLkWhy', 'tkLkActions', 'tkLkStart', 'tkLkWarn'],
  tkDiag: [...tkPage, 'dgBox', 'dgHead', 'dgHeadIcon', 'dg2', 'dg3', 'dgCode', 'dgPre', 'dgBase', 'dgBaseCode'],
  tkDiagRefused: [...tkPage, 'dgBox', 'dgHead', 'dgHeadIcon', 'dg2', 'dg3', 'dgList', 'dgLi1', 'dgLi2', 'dgLiCode'],
  tkForm: tkFormParts,
  tkFormEdit: tkFormParts,
  tkLink: [...DIALOG, 'lkGroup', 'lkLabel', 'lkSelect', 'lkHint', 'lkAdd'],
};
const TRACKING = ['tkError', 'tkLoading', 'tkEmpty', 'tkList', 'tkMoves', 'tkDiag', 'tkDiagRefused', 'tkLookup', 'tkForm', 'tkFormEdit', 'tkLink'];
// What the server says to "Test connection" when the carrier's key has been tried every way: a header to set, then every header refused.
const KEY_STATUS = {
  provider: 'safecube', configured: true, auth_header: 'API_KEY', carrier_has_position: true, ais: 'configured', webhook_ready: false,
  probe: 'unauthorized', reachable: false, http: 401, detail: 'refused',
};
const KEY_FOUND = { ...KEY_STATUS, auth: { ok: true, already: false, shape: 'X-API-Key', env: 'CONTAINER_TRACKING_HEADER=X-API-Key', base: 'https://api.example.com/v2' } };
const KEY_REFUSED = { ...KEY_STATUS, auth: { ok: false, reason: 'The key itself looks wrong, or is not active yet.', attempts: [{ shape: 'Authorization: Bearer', code: 'unauthorized', status: 401 }, { shape: 'X-API-Key', code: 'unauthorized', status: 401 }] } };
// What a state does not compare in one portal, and why. The classic team page's box form offers Delete — a button that asks a route the
// team does not have (deleting a box is the administrator's), so it can only fail — and the new team page does not draw it; the buttons
// that sit beside it in the sheet's foot are therefore not where they were (on a phone the classic foot is a line taller for it): the foot
// and its buttons are held to the classic ones by the new-box form, which has no Delete.
const SKIP = { team: { tkFormEdit: ['sFoot', 'cancelBtn', 'saveBtn', 'tfCancel', 'tfDelete', 'tfSave'] } };
const NO_WORDS = new Set();
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = arg('widths') ? arg('widths').split(',').map(Number) : [390, 670, 800, 1100];

// What the pages hold. Times are far from "now" so they read the same in two pages opened a while apart.
const at = d => new Date(Date.UTC(2026, 8, d, 10, 30)).toISOString();
const unit = over => ({ consignee: '', colour: '', vin: '', status: 'send_to_supplier', price_list: 0, discounted: 0, logistics: '', supplier: '', ...over });
const vehicles = () => [
  { id: 1, make: 'BYD', model: 'Seal', trim: 'Design', price: 1950000, quantity: 2, notes: 'Immediate delivery', legacy_count: null, created_by: 'dashboard', created_at: at(1), updated_at: at(1),
    units: [unit({ vin: 'LGXC76C41P0123456', colour: 'White / Black', status: 'in_logistics', price_list: 1950000, supplier: 'BYD', consignee: 'Hany' }),
      unit({ vin: 'LGXC76C41P0123457', colour: 'Grey', status: 'delivered', supplier: 'BYD' })] },
  { id: 2, make: 'Toyota', model: 'Corolla', trim: 'GLI 1.6', price: 1150000, quantity: 0, notes: '', legacy_count: 3, units: [], created_by: 'dashboard', created_at: at(2), updated_at: at(2) },
  { id: 3, make: 'BYD', model: 'Atto 3', trim: '', price: 0, quantity: 1, notes: '', legacy_count: null, created_by: 'dashboard', created_at: at(3), updated_at: at(3),
    units: [unit({ colour: 'Red', status: 'in_preparation', price_list: 800000 })] },
];
const boxes = () => [
  { id: 1, container_no: 'CSQU3054383', container_type: "40' HIGH CUBE", bl_number: '', carrier: 'MSC', status: 'in_transit', latest_move: 'Vessel departure', latest_move_at: at(1), pod_eta: '2026-11-20', vessel_name: 'MSC AURORA', vessel_imo: '9876543', pol_code: 'CNSHA', pol_name: 'Shanghai', pod_code: 'EGALY', pod_name: 'Alexandria',
    atd: '2026-08-01T00:00:00.000Z', eta: '2036-01-01T00:00:00.000Z', moves: [{ at: at(1), event: 'Vessel departure', place: 'Shanghai', vessel: 'MSC AURORA' }, { at: '2026-11-19T00:00:00.000Z', event: 'Discharge (expected)', place: 'Alexandria', vessel: '' }],
    po_id: null, supplier: '', notes: '', source: 'manual', last_synced_at: null, raw: {}, created_by: 'dashboard', created_at: at(1), updated_at: at(1),
    vessel_lat: 31.2, vessel_lon: 29.9, vessel_position_at: '2026-01-01T00:00:00.000Z', vessel_course: 90, vessel_speed: 12.3, vessel_mmsi: '', position_source: '' },
  { id: 2, container_no: 'MSKU9070327', container_type: '', bl_number: '', carrier: '', status: 'arrived', latest_move: '', latest_move_at: null, pod_eta: null, vessel_name: '', vessel_imo: '', pol_code: '', pol_name: '', pod_code: '', pod_name: '', atd: null, eta: null, moves: [],
    po_id: null, supplier: '', notes: '', source: 'manual', last_synced_at: null, raw: {}, created_by: 'dashboard', created_at: at(2), updated_at: at(2) },
];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 4012 });
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
      db.tables.stock_vehicles = vehicles();
      db.tables.shipment_containers = boxes();
      db.tables.container_vehicles = [{ container_id: 1, vin: 'LGXC76C41P0123456' }];
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
      const seen = await page.evaluate(() => (document.querySelector('[data-part=stockPage], #page-stock') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const exists = (classic, now, what) => until(s => !!document.querySelector(s), pick(classic, now), what);
    const gone = (classic, now, what) => until(s => !document.querySelector(s), pick(classic, now), what);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const reading = async state => {
      const skip = (SKIP[p.who] || {})[state] || [];
      const which = Object.fromEntries(READS[state].filter(r => !skip.includes(r)).map(r => [r, ROLES[r]]).filter(([, d]) => d));
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
    const doneSel = pick(`${TABLE} .stk-views, ${TABLE} .error-msg`, `${XT} [data-part=views], ${XT} [data-part=error]`);
    const open = async () => {
      await go('stock');
      await until(s => !!document.querySelector(s), doneSel, 'the register');
    };
    const leave = async () => {
      await go('home');
      await until(s => !document.querySelector(s), pick(PAGE + '.active', '[data-part=stockPage]'), 'the page to be left');
    };
    const reopen = async () => { await leave(); await open(); };
    const view = n => click(`${TABLE} .stk-views .task-view-tab:nth-child(${n})`, `${XT} [data-part=views] > :nth-child(${n})`);
    const closeSheet = async () => {
      if (next) { await page.keyboard.press('Escape'); } else { await page.evaluate(() => hideModal()); }
      await gone('#modal-overlay[style*="flex"]', '[data-part=dialog]', 'the dialog to close');
    };
    const addButton = '#stock-add-btn';

    // the register: first a server that cannot be reached (nothing has been read yet, so no figures are left over from an earlier
    // read — the classic page keeps the figures of the last good read above its "Failed to load stock."), then the loader (the server
    // is slow), then the register as it is
    if (states.includes('stError')) {
      // (a server that answers with an error is, in the classic page, an empty register; it is when nothing comes at all that it says so)
      stub = (u, m) => (m === 'GET' && /\/stock$/.test(u) ? { abort: true } : null);
      await open();
      await exists(`${TABLE} .error-msg`, `${XT} [data-part=error]`, 'the error');
      await reading('stError');
      stub = null;
      await leave();
    }
    if (states.includes('stLoading')) {
      db.latency = 1500;
      await go('stock');
      await exists(`${TABLE} .loading`, `${XT} [data-part=loading]`, 'the loader');
      await reading('stLoading');
      db.latency = 0;
      await open();
    } else await open();
    if (states.includes('stList')) await reading('stList');
    // narrowed to a status, and grouped
    if (states.includes('stFilter')) {
      await click(`${TABLE} .stk-controls .tbar-btn:nth-child(1)`, `${XT} [data-part=filter]`);
      await exists('.bselect-menu.open .bselect-opt', '[role=listbox] [role=option]', 'the filter menu');
      await page.evaluate(next => { const o = [...document.querySelectorAll(next ? '[role=option]' : '.bselect-menu.open .bselect-opt')]; o[3].click(); }, next);
      await exists(`${TABLE} .filter-chip`, `${XT} [data-part=chip]`, 'the chip');
      await click(`${TABLE} .stk-controls .tbar-btn:nth-child(2)`, `${XT} [data-part=groupBy]`);
      await exists(`${TABLE} .stk-group`, `${XT} [data-part=supplierGroup]`, 'the groups');
      await reading('stFilter');
      // (the classic page remembers the status and the grouping for as long as it stays open; the new one starts clean at each visit)
      await click(`${TABLE} .filter-chip`, `${XT} [data-part=chip]`);
      await click(`${TABLE} .stk-controls .tbar-btn:nth-child(2)`, `${XT} [data-part=groupBy]`);
      await gone(`${TABLE} .stk-group`, `${XT} [data-part=supplierGroup]`, 'the groups to go');
    }
    // by status, by model
    if (states.includes('stStatus')) { await view(2); await exists(`${TABLE} .lead-board`, `${XT} [data-part=board]`, 'the lanes'); await reading('stStatus'); }
    if (states.includes('stModel')) { await view(3); await exists(`${TABLE} .stock-grid`, `${XT} [data-part=modelGrid]`, 'the cards'); await reading('stModel'); }
    await view(1);
    // empty, error
    if (states.includes('stEmpty')) {
      db.tables.stock_vehicles = [];
      await reopen();
      await exists(`${TABLE} .stk-views`, `${XT} [data-part=views]`, 'the empty register');
      await reading('stEmpty');
      reset();
      await reopen();
    }
    // the form, new
    if (states.includes('stForm')) {
      await click(addButton, '[data-part=add]');
      await exists('#stk-make', '#stk-make', 'the form');
      await sleep(300);
      await reading('stForm');
      await closeSheet();
    }
    // …and a model opened for change, with two cars
    if (states.includes('stFormEdit')) {
      await click(`${TABLE} tbody tr:nth-child(1) .stk-edit`, `${XT} [data-part=unitRow]:nth-child(1) [data-part=rowEdit]`);
      await exists('#stk-make', '#stk-make', 'the form');
      await sleep(300);
      await reading('stFormEdit');
      await closeSheet();
    }
    // the bulk upload (the administrator's): the sheet, Upload with nothing chosen, then a file with a good row and a bad one
    if (p.who === 'admin' && ['stCsv', 'stCsvPick', 'stCsvDone'].some(s => states.includes(s))) {
      const upload = () => click('#modal-footer .btn-primary', '[data-part=dialog] [data-part=foot] > [data-part=upload]');
      await click(`${PAGE} .page-header .btn-outline`, '[data-part=csv]');
      await exists('#stock-csv-file', '[data-part=csvFile]', 'the upload sheet');
      await sleep(300);
      if (states.includes('stCsv')) await reading('stCsv');
      if (states.includes('stCsvPick')) {
        await upload();
        await exists('#stock-csv-result .error-msg', '[data-part=csvResult] [role=alert]', 'the sheet to say a file is wanted');
        await reading('stCsvPick');
      }
      if (states.includes('stCsvDone')) {
        const input = await page.$(pick('#stock-csv-file', '[data-part=csvFile]'));
        await input.uploadFile(CSV_FILE);
        await upload();
        await until(s => /Imported/.test((document.querySelector(s) || {}).textContent || ''), pick('#stock-csv-result', '[data-part=csvResult]'), 'the sheet to say what went in');
        await reading('stCsvDone');
      }
      await closeSheet();
      reset();
      await reopen();
    }

    // the Tracking tab
    if (TRACKING.some(s => states.includes(s))) {
      const LC = '#logi-containers', XLC = '[data-part=trackingPane] [data-part=containers]';
      const LB = '#inv-pane-tracking .logi-bar', XLB = '[data-part=trackingPane] [data-part=bar]';
      const tab = n => click(`${PAGE} .logi-tab:nth-child(${n})`, `[data-part=tabs] > :nth-child(${n})`);
      const toTracking = () => tab(2);
      const toModels = () => tab(1);
      reset();
      await reopen();
      // the board could not be had
      if (states.includes('tkError')) {
        stub = (u, m) => (m === 'GET' && /\/containers$/.test(u) ? { abort: true } : null);
        await toTracking();
        await exists(`${LC} .error-msg`, `${XLC} [data-part=error]`, 'the board to say it could not be had');
        await reading('tkError');
        stub = null;
        await toModels();
      }
      // …the server is slow
      if (states.includes('tkLoading')) {
        db.latency = 1500;
        await toTracking();
        await exists(`${LC} .loading`, `${XLC} [data-part=loading]`, 'the board loader');
        await reading('tkLoading');
        db.latency = 0;
        await exists(`${LC} .logi-ct-grid`, `${XLC} [data-part=board]`, 'the boxes');
        await toModels();
      }
      // …nothing is tracked yet
      if (states.includes('tkEmpty')) {
        db.tables.shipment_containers = [];
        await toTracking();
        await exists(`${LC} .logi-empty`, `${XLC} [data-part=nothing]`, 'the empty board');
        await reading('tkEmpty');
        reset();
        await toModels();
      }
      // the boxes: one with a voyage, the port calls and a fix on the map; one with none of those
      await toTracking();
      await exists(`${LC} .logi-ct-grid`, `${XLC} [data-part=board]`, 'the boxes');
      await exists(`${LC} .logi-map-fallback`, `${XLC} [data-part=mapFallback]`, 'the map to give way');
      if (states.includes('tkList')) await reading('tkList');
      if (states.includes('tkMoves')) {
        const sum = [`${LC} .logi-ct:nth-child(1) .logi-moves > summary`, `${XLC} [data-part=container]:nth-child(1) [data-part=moves] > summary`];
        await click(...sum);
        await exists(`${LC} .logi-ct:nth-child(1) .logi-moves[open]`, `${XLC} [data-part=moves][open]`, 'the port calls to open');
        await sleep(200);
        await reading('tkMoves');
        await click(...sum);
        await gone(`${LC} .logi-moves[open]`, `${XLC} [data-part=moves][open]`, 'the port calls to close');
      }
      // what the server found trying the carrier's key every way
      for (const [state, found] of [['tkDiag', KEY_FOUND], ['tkDiagRefused', KEY_REFUSED]]) {
        if (!states.includes(state)) continue;
        stub = (u, m) => (m === 'GET' && /\/containers\/provider-status/.test(u) ? { status: 200, body: found } : null);
        await click(`${LB} > button:nth-child(4)`, `${XLB} [data-part=check]`);
        await exists('#logi-ct-result .logi-empty', '[data-part=result] [data-part=diagnosis]', 'the diagnosis');
        await reading(state);
        stub = null;
      }
      // a box that is not tracked (no carrier set up here): what it says, and the check digit
      if (states.includes('tkLookup')) {
        await page.click('#logi-ct-search', { clickCount: 3 });
        await page.type('#logi-ct-search', 'ABCU1234567');
        await click(`${LB} > button:nth-child(2)`, `${XLB} [data-part=track]`);
        await exists('#logi-ct-result .logi-empty', '[data-part=result] [data-part=notTracked]', 'the lookup to say it is not tracked');
        await reading('tkLookup');
      }
      // the form, new and then a box opened for change
      if (states.includes('tkForm')) {
        await click(`${LB} > button:nth-child(3)`, `${XLB} [data-part=addBox]`);
        await exists('#ct-no', '#ct-no', 'the box form');
        await sleep(300);
        await reading('tkForm');
        await closeSheet();
      }
      if (states.includes('tkFormEdit')) {
        await click(`${LC} .logi-ct:nth-child(1) .logi-ct-actions > :nth-child(2)`, `${XLC} [data-part=container]:nth-child(1) [data-part=edit]`);
        await exists('#ct-no', '#ct-no', 'the box form');
        await sleep(300);
        await reading('tkFormEdit');
        await closeSheet();
      }
      // the sheet that puts a car in a box
      if (states.includes('tkLink')) {
        await click(`${LC} .logi-ct:nth-child(2) .logi-units > .btn`, `${XLC} [data-part=container]:nth-child(2) [data-part=link]`);
        await exists('#ct-unit-pick', '[data-part=carPick]', 'the link sheet');
        await sleep(300);
        await reading('tkLink');
        await closeSheet();
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
  const combos = new Set();
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
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > combos.size * 200000, `${compared} in ${combos.size} readings`);
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
