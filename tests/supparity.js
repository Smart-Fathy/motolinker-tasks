// The new app's Suppliers screen against the classic portals', value by value — the same method as tests/subparity.js and
// tests/meetparity.js (see there): the classic page and the new app opened as the same person, in both portals, both colour
// modes and two looks, at a phone's width, two in-betweens and a desktop, and the computed style of every named part compared, and
// the words in them.
//
//   cards        the register as cards, in name order: one with nothing but a name, one with names too long for a card, one with everything
//   cardsBare    …where the other sections will not say (no stock, no catalogue): no figures, not zeros
//   table        the register as a table: the fields the administrator arranged (a dropdown with colours, a box, a link, text)
//   loading      the server is slow to answer
//   empty        no suppliers yet (the field controls are there all the same)
//   error        the server could not be asked
//   form         "Add supplier": the register's own fields, as the types they were given
//   formEdit     …a supplier opened for editing, with what it holds
//   formError    …saved with no name
//   vehicles     a supplier's catalogue: a grid of lines (and, for the administrator, the controls over it)
//   vehiclesNone …a supplier that offers nothing yet
//   docs         its paperwork        docsNone
//   purchases    what was bought      purchasesNone
//   menu         (admin) the menu behind a column's chevron      picker  the "Columns" list
//   addField     (admin) the editor's dialogs: add a field, edit one, change its type, edit a dropdown's options
//   editField    typeDialog   optionsDialog
//
// What the server says is the server's, and the same on both sides: this is one handler for the two portals, and the classic page
// and the new app ask it the same questions.
// Run with --print to see every difference rather than the first few; --only=admin (or team) for a half; --states=a,b for a few.
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

function rolesFor(who) {
  const P = '#page-suppliers';
  const L = '#suppliers-list';
  const N = '[data-part=list] ';
  const R = {
    root: part(P, '[data-part=suppliersPage]', 'none'),
    list: role(L, '[data-part=list]'),
    loading: role(`${L} .loading`, `${N}[data-part=loading]`, true),
    spinner: role(`${L} .spinner`, `${N}[data-part=loading] > :first-child`),
    error: role(`${L} .error-msg`, `${N}[data-part=error]`, true),
    head: role(`${L} .sup-head`, `${N}[data-part=head]`),
    count: role(`${L} .sup-count`, `${N}[data-part=count]`, true),
    views: role(`${L} .sup-views`, `${N}[data-part=views]`),
    tabCards: role(`${L} .sup-views > button:nth-child(1)`, `${N}[data-part=viewTab]:nth-child(1)`, true),
    tabTable: role(`${L} .sup-views > button:nth-child(2)`, `${N}[data-part=viewTab]:nth-child(2)`, true),
    colsBtn: role(`${L} .sup-head > button:nth-of-type(1)`, `${N}[data-part=colsButton]`, true),
    fieldBtn: role(`${L} .sup-head > button:nth-of-type(2)`, `${N}[data-part=fieldButton]`, true),
    none: role(`${L} .stk-none`, `${N}[data-part=none]`, true),
    grid: role(`${L} .sup-grid`, `${N}[data-part=grid]`),
  };
  // the cards
  for (const n of [1, 2, 3]) {
    const C = `${L} .sup-card:nth-child(${n})`, X = `${N}[data-part=card]:nth-child(${n})`;
    Object.assign(R, {
      [`card${n}`]: role(C, X),
      [`cardHead${n}`]: role(`${C} .sup-card-head`, `${X} [data-part=cardHead]`),
      [`av${n}`]: role(`${C} .sup-av`, `${X} [data-part=avatar]`, true),
      [`name${n}`]: role(`${C} .sup-name`, `${X} [data-part=name]`, true),
      [`sub${n}`]: role(`${C} .sup-sub`, `${X} [data-part=sub]`, true),
      [`acts${n}`]: role(`${C} .sup-card-acts`, `${X} [data-part=acts]`),
      [`cardEdit${n}`]: role(`${C} .sup-card-acts > button:nth-child(1)`, `${X} [data-part=cardEdit]`),
      [`cardDel${n}`]: role(`${C} .sup-card-acts > button:nth-child(2)`, `${X} [data-part=cardDelete]`),
      [`stats${n}`]: role(`${C} .sup-stats`, `${X} [data-part=stats]`),
      [`gos${n}`]: role(`${C} .sup-gos`, `${X} [data-part=gos]`),
    });
    for (const k of [1, 2, 3]) {
      Object.assign(R, {
        [`stat${n}${k}`]: role(`${C} .sup-stat:nth-child(${k})`, `${X} [data-part=stats] > div:nth-child(${k})`),
        [`statLabel${n}${k}`]: role(`${C} .sup-stat:nth-child(${k}) span`, `${X} [data-part=stats] > div:nth-child(${k}) span`, true),
        [`fig${n}${k}`]: role(`${C} .sup-stat:nth-child(${k}) b`, `${X} [data-part=stats] > div:nth-child(${k}) b`, true),
        [`go${n}${k}`]: role(`${C} .sup-go:nth-child(${k})`, `${X} [data-part=go]:nth-child(${k})`, true),
      });
    }
  }
  // the table
  const T = `${L} tbody tr`, XT = `${N}[data-part=row]`;
  Object.assign(R, {
    tableScroll: role(`${L} .table-scroll`, `${N}[data-part=tableScroll]`),
    table: role(`${L} table`, `${N}[data-part=table]`),
    headRow: role(`${L} thead tr`, `${N}[data-part=headRow]`),
  });
  for (const c of [1, 3, 6, 7, 8, 10]) {
    Object.assign(R, {
      [`th${c}`]: role(`${L} thead th:nth-child(${c})`, `${N}[data-part=headRow] > :nth-child(${c})`, true),
    });
  }
  Object.assign(R, {
    chev1: role(`${L} thead th:nth-child(1) .col-chev-btn`, `${N}[data-part=headRow] > :nth-child(1) [data-part=chevron]`),
  });
  for (const r of [1, 2]) {
    R[`row${r}`] = role(`${T}:nth-child(${r})`, `${XT}:nth-child(${r})`);
    for (const c of [1, 2, 3, 5, 6, 7, 8, 10]) {
      R[`td${r}${c}`] = role(`${T}:nth-child(${r}) td:nth-child(${c})`, `${XT}:nth-child(${r}) > :nth-child(${c})`, true);
    }
    R[`pill${r}`] = role(`${T}:nth-child(${r}) td:nth-child(6) span`, `${XT}:nth-child(${r}) > :nth-child(6) [data-part=badge]`, true);
    R[`pillCountry${r}`] = role(`${T}:nth-child(${r}) td:nth-child(3) span`, `${XT}:nth-child(${r}) > :nth-child(3) [data-part=badge]`, true);
  }
  Object.assign(R, {
    link1: role(`${T}:nth-child(1) td:nth-child(8) a`, `${XT}:nth-child(1) > :nth-child(8) [data-part=link]`, true),
    open1: role(`${T}:nth-child(1) td:nth-child(10) .btn:nth-of-type(1)`, `${XT}:nth-child(1) [data-part=rowOpen]`, true),
    edit1: role(`${T}:nth-child(1) td:nth-child(10) .btn:nth-of-type(2)`, `${XT}:nth-child(1) [data-part=rowEdit]`, true),
    del1: role(`${T}:nth-child(1) td:nth-child(10) .btn:nth-of-type(3)`, `${XT}:nth-child(1) [data-part=rowDelete]`, true),
  });

  // the page around the register — each portal's own markup
  if (who === 'admin') {
    Object.assign(R, {
      pageHead: role(`${P} .page-header`, '[data-part=pageHead]'),
      pageTitle: role(`${P} .page-title`, '[data-part=pageTitle]', true),
      add: role(`${P} .page-header .btn`, '[data-part=add]', true),
      pageBody: role(`${P} > div:has(> ${L})`, '[data-part=pageBody]'),
      pageHint: role(`${P} > div:has(> ${L}) > div:first-child`, '[data-part=pageHint]', true),
    });
  } else {
    Object.assign(R, {
      // (the classic page carries the assistant's card first; the page's own wrapper is the shell's, in the new app)
      root: part(P, '[data-part=page]', 'none'),
      pageBody: role(`${P} > div:not(.ai-card)`, '[data-part=suppliersPage]'),
      pageHead: role(`${P} > div:not(.ai-card) > div:first-child`, '[data-part=pageHead]'),
      pageTitle: role(`${P} .card-title`, '[data-part=pageTitle]', true),
      pageHint: role(`${P} .card-title + div`, '[data-part=pageHint]', true),
      add: role(`${P} .btn-primary`, '[data-part=add]', true),
    });
  }

  // a dialog of the page (the form, and a supplier's pages)
  const D = '[data-part=dialog] ';
  Object.assign(R, {
    curtain: free('#modal-overlay', '[data-part=curtain]'),
    dialog: free('#modal-box', '[data-part=dialog]'),
    head2: free('#modal-box .modal-header', `${D}> [data-part=head]`),
    sTitle: free('#modal-title', `${D}> [data-part=head] > [data-part=title]`, true),
    close: free('#modal-box .modal-close', `${D}> [data-part=head] > [data-part=close]`, true),
    sBody: free('#modal-body', `${D}> [data-part=body]`),
    sFoot: free('#modal-footer', `${D}> [data-part=foot]`),
    cancelBtn: free('#modal-footer .btn-outline', `${D}> [data-part=foot] > [data-part=cancel]`, true),
    saveBtn: free('#modal-footer .btn-primary', `${D}> [data-part=foot] > [data-part=save]`, true),
    closeBtn: free('#modal-footer .btn-outline', `${D}> [data-part=foot] > [data-part=close]`, true),
    fields: free('#modal-body > div:nth-child(1)', `${D}[data-part=fields]`),
    formErr: free('#sup-err', `${D}[data-part=formError]`, true),
  });
  // …the form's fields: name (1), country as a dropdown (3), notes (5), rating as a dropdown (6), a box (7), a link (8)
  const g = n => [`#modal-body .form-group:nth-child(${n})`, `${D}[data-part=fields] > [data-part=field]:nth-child(${n})`];
  for (const n of [1, 3, 6, 7, 8]) {
    const [c, x] = g(n);
    R[`fGroup${n}`] = free(c, x);
    if (n !== 7) R[`fLabel${n}`] = free(`${c} .form-label`, `${x} [data-part=fieldLabel]`, true);
  }
  Object.assign(R, {
    fInput1: free(`${g(1)[0]} .form-control`, `${g(1)[1]} [data-part=fieldInput]`),
    fSelect3: free(`${g(3)[0]} .bselect-trigger`, `${g(3)[1]} [data-part=fieldSelect]`, true),
    fSelect6: free(`${g(6)[0]} .bselect-trigger`, `${g(6)[1]} [data-part=fieldSelect]`, true),
    fTick7: free(`${g(7)[0]} label`, `${g(7)[1]} [data-part=fieldTick]`, true),
    fBox7: free(`${g(7)[0]} input`, `${g(7)[1]} [data-part=fieldBox]`),
    fInput8: free(`${g(8)[0]} .form-control`, `${g(8)[1]} [data-part=fieldInput]`),
  });
  // a supplier's pages
  const S = '#sup-pane';
  Object.assign(R, {
    tabs: free('#modal-body .sup-tabs', `${D}[data-part=tabs]`),
    tab1: free('#modal-body .sup-tab:nth-child(1)', `${D}[data-part=tab]:nth-child(1)`, true),
    tab2: free('#modal-body .sup-tab:nth-child(2)', `${D}[data-part=tab]:nth-child(2)`, true),
    tab3: free('#modal-body .sup-tab:nth-child(3)', `${D}[data-part=tab]:nth-child(3)`, true),
    pane: free(S, `${D}[data-part=pane]`),
    paneLoading: free(`${S} .loading`, `${D}[data-part=paneLoading]`),
    vehBar: free(`${S} > div:nth-child(1)`, `${D}[data-part=vehicleBar]`),
    // (the controls over a grid of lines are the administrator's)
    ...(who === 'admin' ? {
      vehCols: free(`${S} > div:nth-child(1) > .btn:nth-of-type(1)`, `${D}[data-part=colsButton]`, true),
      vehField: free(`${S} > div:nth-child(1) > .btn:nth-of-type(2)`, `${D}[data-part=fieldButton]`, true),
    } : {}),
    vehAdd: free(`${S} > div:nth-child(1) > .btn:last-of-type`, `${D}[data-part=addVehicle]`, true),
    gridBox: free(`${S} > div:nth-child(2)`, `${D}[data-part=gridBox]`),
    gridTable: free(`${S} table`, `${D}[data-part=gridTable]`),
    nothing: free(`${S} > div:nth-child(3)`, `${D}[data-part=nothing]`, true),
  });
  for (const c of [1, 4, 5, 6, 9]) R[`gh${c}`] = free(`${S} thead th:nth-child(${c})`, `${D}[data-part=gridTable] thead th:nth-child(${c})`, true);
  for (const r of [1, 2]) {
    const V = `#sup-v-body tr:nth-child(${r})`, XV = `${D}[data-part=vehicleRow]:nth-child(${r})`;
    R[`vrow${r}`] = free(V, XV);
    for (const c of [1, 4, 6, 8, 9]) {
      R[`vcell${r}${c}`] = free(`${V} td:nth-child(${c})`, `${XV} > :nth-child(${c})`);
      R[`vin${r}${c}`] = free(`${V} td:nth-child(${c}) .sup-v`, `${XV} > :nth-child(${c}) [data-part=gridInput], ${XV} > :nth-child(${c}) [data-part=gridArea], ${XV} > :nth-child(${c}) [data-part=gridBox], ${XV} > :nth-child(${c}) [data-part=gridSelect]`);
    }
    R[`vdel${r}`] = free(`${V} td:last-child .btn`, `${XV} > :last-child [data-part=vehicleDelete]`);
  }
  // paperwork
  Object.assign(R, {
    upload: free(`${S} > div:nth-child(1)`, `${D}[data-part=upload]`),
    uploadBtn: free(`${S} > div:nth-child(1) .btn`, `${D}[data-part=uploadButton]`, true),
    uploadHint: free(`${S} > div:nth-child(1) > span`, `${D}[data-part=upload] > span`, true),
    files: free(`${S} .hd-files`, `${D}[data-part=files]`),
    file1: free(`${S} .hd-file:nth-child(1)`, `${D}[data-part=files] > a:nth-child(1)`),
    fileIcon1: free(`${S} .hd-file:nth-child(1) .hd-file-ic`, `${D}[data-part=files] > a:nth-child(1) > div:nth-child(1)`),
    fileName1: free(`${S} .hd-file:nth-child(1) .hd-file-name`, `${D}[data-part=files] > a:nth-child(1) > div:nth-child(2) > div:nth-child(1)`, true),
    fileSub1: free(`${S} .hd-file:nth-child(1) .hd-file-sub`, `${D}[data-part=files] > a:nth-child(1) > div:nth-child(2) > div:nth-child(2)`, true),
    noDocs: free(`${S} > div:nth-child(3)`, `${D}[data-part=nothing]`, true),
  });
  // purchases
  Object.assign(R, {
    tiles: free(`${S} > div:nth-child(1)`, `${D}[data-part=tiles]`),
    leadTimes: free(`${S} > div:nth-child(2)`, `${D}[data-part=leadTimes]`, true),
    secLabel1: free(`${S} > div:nth-child(3)`, `${D}[data-part=pane] > div:nth-child(3)`, true),
    unitsBox: free(`${S} > div:nth-child(4)`, `${D}[data-part=unitsBox]`),
    secLabel2: free(`${S} > div:nth-child(5)`, `${D}[data-part=pane] > div:nth-child(5)`, true),
    linesBox: free(`${S} > div:nth-child(6)`, `${D}[data-part=linesBox]`),
    // (nothing bought: no lead times seen, so the labels and the two lines of words are one place nearer the top)
    nSecLabel1: free(`${S} > div:nth-child(2)`, `${D}[data-part=pane] > div:nth-child(2)`, true),
    noUnits: free(`${S} > div:nth-child(3)`, `${D}[data-part=noUnits]`, true),
    nSecLabel2: free(`${S} > div:nth-child(4)`, `${D}[data-part=pane] > div:nth-child(4)`, true),
    noLines: free(`${S} > div:nth-child(5)`, `${D}[data-part=noLines]`, true),
  });
  for (const n of [1, 2, 3, 4]) {
    R[`tile${n}`] = free(`${S} > div:nth-child(1) > div:nth-child(${n})`, `${D}[data-part=tiles] > [data-part=tile]:nth-child(${n})`);
    R[`tileTitle${n}`] = free(`${S} > div:nth-child(1) > div:nth-child(${n}) > div:nth-child(1)`, `${D}[data-part=tiles] > [data-part=tile]:nth-child(${n}) > div:nth-child(1)`, true);
    R[`tileBig${n}`] = free(`${S} > div:nth-child(1) > div:nth-child(${n}) > div:nth-child(2)`, `${D}[data-part=tiles] > [data-part=tile]:nth-child(${n}) > div:nth-child(2)`, true);
  }
  Object.assign(R, {
    uTable: free(`${S} > div:nth-child(4) table`, `${D}[data-part=unitsBox] table`),
    uHead1: free(`${S} > div:nth-child(4) th:nth-child(1)`, `${D}[data-part=unitsBox] th:nth-child(1)`, true),
    uHead4: free(`${S} > div:nth-child(4) th:nth-child(4)`, `${D}[data-part=unitsBox] th:nth-child(4)`, true),
    uCell1: free(`${S} > div:nth-child(4) tbody tr:nth-child(1) td:nth-child(1)`, `${D}[data-part=unitsBox] tbody tr:nth-child(1) td:nth-child(1)`, true),
    uCell4: free(`${S} > div:nth-child(4) tbody tr:nth-child(1) td:nth-child(4)`, `${D}[data-part=unitsBox] tbody tr:nth-child(1) td:nth-child(4)`, true),
    lHead1: free(`${S} > div:nth-child(6) th:nth-child(1)`, `${D}[data-part=linesBox] th:nth-child(1)`, true),
    lCell1: free(`${S} > div:nth-child(6) tbody tr:nth-child(1) td:nth-child(1)`, `${D}[data-part=linesBox] tbody tr:nth-child(1) td:nth-child(1)`, true),
    lCell4: free(`${S} > div:nth-child(6) tbody tr:nth-child(1) td:nth-child(4)`, `${D}[data-part=linesBox] tbody tr:nth-child(1) td:nth-child(4)`, true),
  });

  // the editor: the menu behind a chevron, the "Columns" list, and the editor's dialogs
  const M = '.lead-menu.open', XM = '[data-part=colMenu]';
  Object.assign(R, {
    menu: free(M, XM),
    mItem1: free(`${M} > button:nth-child(1)`, `${XM} > button:nth-child(1)`, true),
    mItem3: free(`${M} > button:nth-child(3)`, `${XM} > button:nth-child(3)`, true),
    mSep: free(`${M} > .lead-menu-sep:nth-of-type(1)`, `${XM} > div:nth-of-type(1)`),
    mLeft: free(`${M} > button:nth-child(5)`, `${XM} > button:nth-child(5)`, true),
    mRight: free(`${M} > button:nth-child(6)`, `${XM} > button:nth-child(6)`, true),
    mDelete: free(`${M} > button:nth-child(9)`, `${XM} > button:nth-child(9)`, true),
    pickHead: free(`${M} > div:nth-child(1)`, `${XM} > div:nth-child(1)`, true),
    pickRow1: free(`${M} > .lead-col-row:nth-child(2)`, `${XM} > div:nth-child(2)`),
    pickEye1: free(`${M} > .lead-col-row:nth-child(2) > .lead-col-eye`, `${XM} > div:nth-child(2) > [data-part=pickEye]`, true),
    pickEdit1: free(`${M} > .lead-col-row:nth-child(2) > .lead-col-edit`, `${XM} > div:nth-child(2) > [data-part=pickEdit]`),
    pickRowHidden: free(`${M} > .lead-col-row:nth-child(11)`, `${XM} > div:nth-child(11)`),
    pickEyeHidden: free(`${M} > .lead-col-row:nth-child(11) > .lead-col-eye`, `${XM} > div:nth-child(11) > [data-part=pickEye]`, true),
    pickAdd: free(`${M} > button:last-child`, `${XM} > [data-part=pickAdd]`, true),
    // the editor's dialogs
    ceCurtain: free('.ce-modal-overlay.open', '[data-part=ceCurtain]'),
    ceDialog: free('.ce-modal-box', '[data-part=ceDialog]'),
    ceHead: free('.ce-modal-head', '[data-part=ceHead]'),
    ceTitle: free('#ce-modal-title', '[data-part=ceTitle]', true),
    ceClose: free('.ce-modal-x', '[data-part=ceClose]', true),
    ceBody: free('#ce-modal-body', '[data-part=ceBody]'),
    ceFoot: free('#ce-modal-foot', '[data-part=ceFoot]'),
    ceCancel: free('#ce-modal-foot .btn-outline', '[data-part=ceFoot] > [data-part=ceCancel]', true),
    ceSave: free('#ce-modal-foot .btn-primary', '[data-part=ceFoot] > [data-part=ceSave]', true),
    ceGroup1: free('#ce-modal-body > .form-group:nth-child(1)', '[data-part=ceBody] > [data-part=ceGroup]:nth-child(1)'),
    ceLabel1: free('#ce-modal-body > .form-group:nth-child(1) .form-label', '[data-part=ceBody] > [data-part=ceGroup]:nth-child(1) [data-part=ceLabel]', true),
    ceName: free('#ce-name', '[data-part=ceName]', false),
    ceTypes: free('.ce-types', '[data-part=ceTypes]'),
    ceType1: free('.ce-type:nth-child(1)', '[data-part=ceType]:nth-child(1)', true),
    ceType5: free('.ce-type:nth-child(5)', '[data-part=ceType]:nth-child(5)', true),
    ceType7: free('.ce-type:nth-child(7)', '[data-part=ceType]:nth-child(7)', true),
    ceOptions: free('#ce-options', '[data-part=ceOptions]'),
    ceExtras: free('#ce-modal-body > .form-group:last-child', '[data-part=ceExtras]'),
    ceRequired: free('#ce-required', '[data-part=ceRequired]'),
    ceWidth: free('#ce-width', '[data-part=ceWidth]'),
    ceOptRow1: free('#ce-opts-list .lo-row:nth-child(1)', '[data-part=ceOptRow]:nth-child(1)'),
    ceOptLabel1: free('#ce-opts-list .lo-row:nth-child(1) > input:nth-child(1)', '[data-part=ceOptRow]:nth-child(1) [data-part=ceOptLabel]'),
    ceOptColor1: free('#ce-opts-list .lo-row:nth-child(1) > input[type=color]', '[data-part=ceOptRow]:nth-child(1) [data-part=ceOptColor]'),
    ceOptX1: free('#ce-opts-list .lo-row:nth-child(1) > button', '[data-part=ceOptRow]:nth-child(1) [data-part=ceOptRemove]', true),
    ceAddOpt: free('#ce-modal-body .btn-sm', '[data-part=ceAddOpt]', true),
    ceHint: free('#ce-modal-body > div:last-child', '[data-part=ceHint]', true),
    ceHintField: free('#ce-options-wrap > div:last-child', '[data-part=ceOptionsWrap] > [data-part=ceHint]', true),
  });
  return R;
}

// What a state reads: the parts it shows (a part that is not there on either side is not compared, one that is on one side only is a failure)
const PAGE = ['root', 'pageHead', 'pageTitle', 'add', 'pageBody', 'pageHint', 'list'];
const HEAD = ['head', 'count', 'views', 'tabCards', 'tabTable', 'colsBtn', 'fieldBtn'];
const cardParts = n => [`card${n}`, `cardHead${n}`, `av${n}`, `name${n}`, `sub${n}`, `acts${n}`, `cardEdit${n}`, `cardDel${n}`, `stats${n}`, `gos${n}`,
  ...[1, 2, 3].flatMap(k => [`stat${n}${k}`, `statLabel${n}${k}`, `fig${n}${k}`, `go${n}${k}`])];
const TABLE = ['tableScroll', 'table', 'headRow', 'th1', 'th3', 'th6', 'th7', 'th8', 'th10', 'chev1',
  ...[1, 2].flatMap(r => [`row${r}`, `pill${r}`, `pillCountry${r}`, ...[1, 2, 3, 5, 6, 7, 8, 10].map(c => `td${r}${c}`)]), 'link1', 'open1', 'edit1', 'del1'];
const DIALOG = ['curtain', 'dialog', 'head2', 'sTitle', 'close', 'sBody', 'sFoot'];
const FORM = [...DIALOG, 'fields', 'cancelBtn', 'saveBtn', 'fGroup1', 'fLabel1', 'fInput1', 'fGroup3', 'fLabel3', 'fSelect3', 'fGroup6', 'fLabel6', 'fSelect6', 'fGroup7', 'fTick7', 'fBox7', 'fGroup8', 'fLabel8', 'fInput8'];
const SUPPLIER = [...DIALOG, 'closeBtn', 'tabs', 'tab1', 'tab2', 'tab3', 'pane'];
const GRID = ['vehBar', 'vehAdd', 'gridBox', 'gridTable', 'gh1', 'gh4', 'gh5', 'gh6', 'gh9',
  ...[1, 2].flatMap(r => [`vrow${r}`, `vdel${r}`, ...[1, 4, 6, 8, 9].flatMap(c => [`vcell${r}${c}`, `vin${r}${c}`])])];
const CE_DIALOG = ['ceCurtain', 'ceDialog', 'ceHead', 'ceTitle', 'ceClose', 'ceBody', 'ceFoot', 'ceCancel', 'ceSave'];
const READS = {
  cards: [...PAGE, ...HEAD, 'grid', ...cardParts(1), ...cardParts(2), ...cardParts(3)],
  cardsBare: [...PAGE, ...HEAD, 'grid', ...cardParts(1), ...cardParts(2)],
  table: [...PAGE, ...HEAD, ...TABLE],
  loading: [...PAGE, 'loading', 'spinner'],
  empty: [...PAGE, ...HEAD, 'none'],
  error: [...PAGE, 'error'],
  form: [...FORM],
  formEdit: [...FORM],
  formError: [...FORM, 'formErr'],
  vehicles: [...SUPPLIER, ...GRID, 'vehCols', 'vehField'],
  vehiclesNone: [...SUPPLIER, 'vehBar', 'vehAdd', 'gridBox', 'gridTable', 'gh1', 'nothing'],
  docs: [...SUPPLIER, 'upload', 'uploadBtn', 'uploadHint', 'files', 'file1', 'fileIcon1', 'fileName1', 'fileSub1'],
  docsNone: [...SUPPLIER, 'upload', 'uploadBtn', 'uploadHint', 'noDocs'],
  purchases: [...SUPPLIER, 'tiles', 'leadTimes', 'secLabel1', 'unitsBox', 'secLabel2', 'linesBox', 'uTable', 'uHead1', 'uHead4', 'uCell1', 'uCell4', 'lHead1', 'lCell1', 'lCell4',
    ...[1, 2, 3, 4].flatMap(n => [`tile${n}`, `tileTitle${n}`, `tileBig${n}`])],
  purchasesNone: [...SUPPLIER, 'tiles', 'nSecLabel1', 'noUnits', 'nSecLabel2', 'noLines', ...[1, 2, 3, 4].flatMap(n => [`tile${n}`, `tileTitle${n}`, `tileBig${n}`])],
  menu: ['menu', 'mItem1', 'mItem3', 'mSep', 'mLeft', 'mRight', 'mDelete'],
  picker: ['menu', 'pickHead', 'pickRow1', 'pickEye1', 'pickEdit1', 'pickRowHidden', 'pickEyeHidden', 'pickAdd'],
  addField: [...CE_DIALOG, 'ceGroup1', 'ceLabel1', 'ceName', 'ceTypes', 'ceType1', 'ceType5', 'ceType7', 'ceExtras', 'ceRequired', 'ceWidth'],
  addFieldSelect: [...CE_DIALOG, 'ceName', 'ceTypes', 'ceType1', 'ceType5', 'ceOptions', 'ceExtras', 'ceRequired', 'ceWidth'],
  editField: [...CE_DIALOG, 'ceGroup1', 'ceName', 'ceTypes', 'ceType5', 'ceOptRow1', 'ceOptLabel1', 'ceOptColor1', 'ceOptX1', 'ceAddOpt', 'ceHintField', 'ceExtras', 'ceRequired', 'ceWidth'],
  typeDialog: [...CE_DIALOG, 'ceGroup1', 'ceLabel1', 'ceTypes', 'ceType1', 'ceType5', 'ceOptions'],
  optionsDialog: [...CE_DIALOG, 'ceOptRow1', 'ceOptLabel1', 'ceOptColor1', 'ceOptX1', 'ceAddOpt', 'ceHint'],
};
// …and the words that are the server's, not the page's — and so what the length of them decides (how tall the box is)
const NO_WORDS = new Set();
const ADMIN_ONLY = new Set(['menu', 'picker', 'addField', 'addFieldSelect', 'editField', 'typeDialog', 'optionsDialog']);
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What the register holds. Times are far from "now" so they read the same in two pages opened a while apart.
const at = d => new Date(Date.UTC(2026, 8, d, 10, 30)).toISOString();
const suppliers = () => [
  { id: 1, name: 'Yu Motors', contact: 'yu@example.com', address: 'Shanghai, Pudong District', country: 'China', notes: 'Pays within 30 days', custom_fields: { cf_rating: 'a', cf_vip: true, cf_site: 'https://yu-motors.example.com/catalogue/price-list-2026.pdf', cf_note: 'Preferred' }, created_by: 'admin', created_at: at(1), updated_at: at(1) },
  { id: 2, name: 'Alpha', contact: '', address: '', country: '', notes: '', custom_fields: {}, created_by: 'admin', created_at: at(2), updated_at: at(2) },
  { id: 3, name: 'Gulf Auto Trading Company For Vehicles And Spare Parts LLC', contact: 'sales-department-of-the-gulf-auto-trading-company@example.com', address: 'Jebel Ali', country: 'United Arab Emirates', notes: 'x', custom_fields: { cf_rating: 'b', cf_vip: false, cf_site: 'not a link', cf_note: '' }, created_by: 'admin', created_at: at(3), updated_at: at(3) },
];
const stock = () => [{ id: 1, make: 'BYD', model: 'Seal', trim: 'Max', price: 30000, quantity: 3, units: [
  { vin: 'V1', supplier: 'Yu Motors', price_list: 32000 }, { vin: 'V2', supplier: 'yu motors', price_list: 34000 },
  { vin: 'V3', supplier: 'Gulf Auto Trading Company For Vehicles And Spare Parts LLC', price_list: 1500000000 },
] }];
const catalogue = () => [
  { id: 1, supplier_id: 1, brand: 'BYD', model: 'Seal', trim: 'Max', model_year: 2026, availability: 'Pre-order', fob_price: 32789, currency: 'USD', lead_time: '4 to 6 weeks', accessories: 'mats, charger', notes: '', custom_fields: { cf_stock: '12', cf_grade: 'a' }, suppliers: { name: 'Yu Motors' } },
  { id: 2, supplier_id: 1, brand: 'Aion', model: 'Y', trim: '', model_year: null, availability: '', fob_price: null, currency: 'USD', lead_time: '', accessories: '', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors' } },
  { id: 3, supplier_id: 3, brand: 'Geely', model: 'Starray', trim: '', model_year: 2026, availability: 'Available', fob_price: 21000, currency: 'USD', lead_time: '8 weeks', accessories: '', notes: '', custom_fields: {}, suppliers: { name: 'Gulf Auto' } },
];
const docs = () => [
  { id: 1, supplier_id: 1, name: 'price-list-2026-with-a-very-long-file-name-that-needs-cutting.pdf', drive_file_id: 'f1', web_link: 'https://drive.example/f1', mime_type: 'application/pdf', size_bytes: 204800, uploaded_by: 'admin', created_at: at(4) },
  { id: 2, supplier_id: 1, name: 'licence.png', drive_file_id: 'f2', web_link: 'https://drive.example/f2', mime_type: 'image/png', size_bytes: 300, uploaded_by: 'admin', created_at: at(5) },
];
const purchaseOrders = () => [{ id: 20, po_number: 'PO-20', po_date: '2026-04-01', supplier_id: 1, supplier: 'Yu Motors', currency: 'USD', items: [
  { brand: 'BYD', model: 'Seal', trim: 'Max', qty: 2, fob_price: '31,000', lead_time: '6 weeks' }, { brand: 'Aion', model: 'Y', qty: 1, lead_time: '6 weeks' }] }];
const configs = () => [
  { key: 'columns_config:suppliers', value: JSON.stringify([
    { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true, width: 140 },
    { key: 'contact', label: 'Contact', type: 'text', builtin: true, visible: true, width: 120 },
    { key: 'country', label: 'Country', type: 'select', builtin: true, visible: true, options: [{ key: 'China', label: 'China', color: '#dc2626' }, { key: 'United Arab Emirates', label: 'UAE' }] },
    { key: 'address', label: 'Address', type: 'text', builtin: true, visible: true, width: 160 },
    { key: 'notes', label: 'Notes', type: 'text', builtin: true, visible: true, width: 160 },
    { key: 'cf_rating', label: 'Rating', type: 'select', builtin: false, visible: true, required: true, options: [{ key: 'a', label: 'Gold', color: '#c9a35e' }, { key: 'b', label: 'Plain' }] },
    { key: 'cf_vip', label: 'VIP', type: 'checkbox', builtin: false, visible: true },
    { key: 'cf_site', label: 'Website', type: 'link', builtin: false, visible: true },
    { key: 'cf_note', label: 'Remark', type: 'text', builtin: false, visible: true },
    { key: 'cf_hidden', label: 'Internal', type: 'text', builtin: false, visible: false },
  ]) },
  { key: 'columns_config:supplier_vehicles', value: JSON.stringify([
    { key: 'brand', label: 'Brand', type: 'text', builtin: true, visible: true, width: 110 },
    { key: 'model', label: 'Model', type: 'text', builtin: true, visible: true, width: 110 },
    { key: 'trim', label: 'Trim', type: 'text', builtin: true, visible: true, width: 100 },
    { key: 'model_year', label: 'Year', type: 'number', builtin: true, visible: true, width: 70 },
    { key: 'availability', label: 'Availability', type: 'text', builtin: true, visible: true, width: 120 },
    { key: 'fob_price', label: 'FOB price', type: 'number', builtin: true, visible: true, width: 100 },
    { key: 'lead_time', label: 'Lead time', type: 'text', builtin: true, visible: true, width: 110 },
    { key: 'accessories', label: 'Accessories', type: 'text', builtin: true, visible: true, width: 160 },
    { key: 'cf_stock', label: 'In stock', type: 'text', builtin: false, visible: true },
    { key: 'cf_grade', label: 'Grade', type: 'select', builtin: false, visible: true, options: [{ key: 'a', label: 'A', color: '#10b981' }, { key: 'b', label: 'B' }] },
  ]) },
];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 4003 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  let stub = null;   // what the server is made to say instead, for the states a real one cannot be put in
  const stubbed = (u, m) => (stub ? stub(u, m) : null);

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const ROLES = rolesFor(p.who);
    const states = Object.keys(READS).filter(s => (p.who === 'admin' || !ADMIN_ONLY.has(s)) && (!STATE_FILTER.length || STATE_FILTER.includes(s)));
    const reset = () => {
      db.tables.suppliers = suppliers(); db.tables.stock_vehicles = stock(); db.tables.supplier_vehicles = catalogue();
      db.tables.supplier_docs = docs(); db.tables.purchase_orders = purchaseOrders();
      db.tables.quotation_settings = (db.tables.quotation_settings || []).filter(r => !/^columns_config:suppliers|^columns_config:supplier_vehicles/.test(r.key)).concat(configs());
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
      const seen = await page.evaluate(() => (document.querySelector('[data-part=list], #suppliers-list') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const exists = (classic, now, what) => until(s => !!document.querySelector(s), pick(classic, now), what);
    const gone = (classic, now, what) => until(s => !document.querySelector(s), pick(classic, now), what);
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    // (a real click, where the position matters: a menu opens at the pointer)
    const press = async (classic, now) => { const el = await page.$(pick(classic, now)); await el.click(); };
    const pressText = (menu, text) => page.evaluate((m, t) => { [...document.querySelectorAll(`${m} button`)].find(b => b.textContent.trim().startsWith(t)).click(); }, menu, text);
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
      await go('suppliers');
      await until(s => !!document.querySelector(s) && !document.querySelector(s + ' .loading, ' + s + ' [data-part=loading]'), pick('#suppliers-list', '[data-part=list]'), 'the register');
    };
    const leave = async () => {
      await go('home');
      await until(s => !document.querySelector(s), pick('#page-suppliers.active', '[data-part=suppliersPage]'), 'the page to be left');
    };
    const want = (s, f) => states.includes(s) && f();
    // (the classic page reads which view it was left in once, when it loads: a person presses the tab, and so does this)
    const view = async v => {
      const n = v === 'table' ? 2 : 1;
      await exists('#suppliers-list .sup-views', '[data-part=views]', 'the views');
      await click(`#suppliers-list .sup-views > button:nth-child(${n})`, `[data-part=views] > [data-part=viewTab]:nth-child(${n})`);
    };
    const closeSheet = async () => {
      if (next) { await page.keyboard.press('Escape'); } else { await page.evaluate(() => hideModal()); }
      await gone('#modal-overlay[style*="flex"]', '[data-part=dialog]', 'the dialog to close');
    };
    const reopen = async () => { await leave(); await open(); };

    // loading — the server is slow, the page is opened, the loader is read before the answer comes
    if (states.includes('loading')) {
      db.latency = 1500;
      await go('suppliers');
      await exists('#suppliers-list .loading', '[data-part=list] [data-part=loading]', 'the loader');
      await reading('loading');
      db.latency = 0;
      await open();
    } else await open();

    // cards (the default view)
    await view('cards');
    await want('cards', async () => { await exists('#suppliers-list .sup-card', '[data-part=card]', 'the cards'); await reading('cards'); });

    // cards where the other sections will not say
    if (states.includes('cardsBare')) {
      stub = (u, m) => (m === 'GET' && /\/(stock|supplier-vehicles)$/.test(u) ? { status: 403, body: { error: 'Not permitted' } } : null);
      await reopen();
      await exists('#suppliers-list .sup-card', '[data-part=card]', 'the cards');
      await reading('cardsBare');
      stub = null;
    }

    // the table
    await view('table');
    await want('table', async () => { await exists('#suppliers-list table', '[data-part=table]', 'the table'); await reading('table'); });

    // the editor, over the table (the administrator's)
    if (p.who === 'admin') {
      if (states.includes('menu')) {
        await press('#suppliers-list thead th:nth-child(1) .col-chev-btn', '[data-part=headRow] > :nth-child(1) [data-part=chevron]');
        await exists('.lead-menu.open', '[data-part=colMenu]', 'the menu');
        await reading('menu');
        await pressText(pick('.lead-menu.open', '[data-part=colMenu]'), 'Change type');
        await exists('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the type dialog');
        await reading('typeDialog');
        await click('.ce-modal-x', '[data-part=ceClose]');
        await gone('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the dialog to close');
      }
      if (states.includes('optionsDialog')) {
        await press('#suppliers-list thead th:nth-child(6) .col-chev-btn', '[data-part=headRow] > :nth-child(6) [data-part=chevron]');
        await exists('.lead-menu.open', '[data-part=colMenu]', 'the menu');
        await pressText(pick('.lead-menu.open', '[data-part=colMenu]'), 'Edit options');
        await exists('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the options dialog');
        await reading('optionsDialog');
        await click('.ce-modal-x', '[data-part=ceClose]');
        await gone('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the dialog to close');
      }
      if (states.includes('picker') || states.includes('editField')) {
        await press(pick('#suppliers-list .sup-head > button:nth-of-type(1)', '[data-part=colsButton]'), '[data-part=colsButton]');
        await exists('.lead-menu.open', '[data-part=colMenu]', 'the picker');
        await reading('picker');
        if (states.includes('editField')) {
          await click('.lead-menu.open .lead-col-row:nth-child(7) .lead-col-edit', '[data-part=colMenu] > div:nth-child(7) [data-part=pickEdit]');
          await exists('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the field dialog');
          await reading('editField');
          await click('.ce-modal-x', '[data-part=ceClose]');
          await gone('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the dialog to close');
        } else await page.mouse.click(5, 5);
      }
      if (states.includes('addField') || states.includes('addFieldSelect')) {
        await press(pick('#suppliers-list .sup-head > button:nth-of-type(2)', '[data-part=fieldButton]'), '[data-part=fieldButton]');
        await exists('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the add dialog');
        await reading('addField');
        await click('.ce-type:nth-child(5)', '[data-part=ceType]:nth-child(5)');
        await exists('#ce-options', '[data-part=ceOptions]', 'the options box');
        await reading('addFieldSelect');
        await click('.ce-modal-x', '[data-part=ceClose]');
        await gone('.ce-modal-overlay.open', '[data-part=ceCurtain]', 'the dialog to close');
      }
    }

    // empty, error
    if (states.includes('empty')) {
      db.tables.suppliers = [];
      await reopen();
      await until(s => { const c = document.querySelector(s); return !!c && c.textContent.includes('No suppliers yet'); }, pick('#suppliers-list', '[data-part=list]'), 'the empty register');
      await reading('empty');
      db.tables.suppliers = suppliers();
      await reopen();
    }
    if (states.includes('error')) {
      db.failing.add('suppliers');
      await reopen();
      await exists('#suppliers-list .error-msg', '[data-part=list] [data-part=error]', 'the error');
      await reading('error');
      db.failing.clear();
      await reopen();
    }

    // the form, over the cards
    await view('cards');
    await exists('#suppliers-list .sup-card', '[data-part=card]', 'the cards');
    if (states.some(s => /^form/.test(s))) {
      await click(pick(p.who === 'admin' ? '#page-suppliers .page-header .btn' : '#page-suppliers .btn-primary', '[data-part=add]'), '[data-part=add]');
      await exists('#modal-body #sup-name', '[data-part=dialog] [data-part=fields]', 'the form');
      await reading('form');
      await click('#modal-footer .btn-primary', '[data-part=dialog] [data-part=save]');
      await exists('#sup-err[style*="block"]', '[data-part=dialog] [data-part=formError]', 'the refusal');
      await reading('formError');
      await click('#modal-footer .btn-outline', '[data-part=dialog] [data-part=cancel]');
      await gone('#modal-overlay[style*="flex"]', '[data-part=dialog]', 'the form to close');
      await click('#suppliers-list .sup-card:nth-child(3) .sup-card-acts > button:nth-child(1)', '[data-part=card]:nth-child(3) [data-part=cardEdit]');
      await exists('#modal-body #sup-name', '[data-part=dialog] [data-part=fields]', 'the edit form');
      await reading('formEdit');
      await closeSheet();
    }

    // a supplier's pages
    const detail = async (n, tab) => {
      await click(`#suppliers-list .sup-card:nth-child(${n}) .sup-go:nth-child(${tab})`, `[data-part=card]:nth-child(${n}) [data-part=go]:nth-child(${tab})`);
      await exists('#sup-pane', '[data-part=dialog] [data-part=pane]', 'the pane');
      await gone('#sup-pane .loading', '[data-part=dialog] [data-part=paneLoading]', 'the pane to load');
    };
    if (states.includes('vehicles')) { await detail(3, 1); await exists('#sup-v-body tr', '[data-part=vehicleRow]', 'the rows'); await reading('vehicles'); await closeSheet(); }
    if (states.includes('vehiclesNone')) { await detail(1, 1); await exists('#sup-pane table', '[data-part=gridTable]', 'the grid'); await reading('vehiclesNone'); await closeSheet(); }
    if (states.includes('docs')) { await detail(3, 2); await exists('#sup-pane .hd-file', '[data-part=files]', 'the files'); await reading('docs'); await closeSheet(); }
    if (states.includes('docsNone')) { await detail(1, 2); await until(s => !!document.querySelector(s), pick('#sup-pane', '[data-part=nothing]'), 'the empty list'); await reading('docsNone'); await closeSheet(); }
    if (states.includes('purchases')) { await detail(3, 3); await exists('#sup-pane .stock-sec-label', '[data-part=unitsBox], [data-part=noUnits]', 'the purchases'); await reading('purchases'); await closeSheet(); }
    if (states.includes('purchasesNone')) { await detail(1, 3); await exists('#sup-pane .stock-sec-label', '[data-part=noUnits]', 'the purchases'); await reading('purchasesNone'); await closeSheet(); }
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
