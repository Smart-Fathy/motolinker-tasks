'use strict';
// The permission catalogue: every section an employee can be given, the actions inside it, what a
// record that predates a section or an action gets, how the admin's editor labels and groups them,
// and the starting-point presets. Data only — the rules that read it are in ./normalise and ./can.
//
// Moved here, unchanged, from src/routes/employee-portal.js, so that the server and the portals read
// one definition. tests/contracts.js pins what it means (tests/fixtures/permissions.golden.json).

// Defaults for an employee whose record predates a section. Everything the whole
// team has always had is `true` here, so adding a section to the model never
// silently takes it away from people who already had it; anything sensitive
// (email, CRM, reports, the issues centre) stays opt-in.
/** @type {Record<string, boolean>} */
const DEFAULT_PERMISSIONS = {
  // Day to day
  requests: true,
  tasks: true,
  hours: true,
  availability: true,
  // Google
  drive: true,
  sheets: true,
  calendar: true,
  meet: true,
  email: false,
  gchat: false,
  // Talking to each other
  chat: true,
  // Inventory, operations and procurement — off until someone is given them
  stock: true,
  suppliers: false,
  rfq: false,
  purchaseorders: false,
  contracts: false,
  submissions: false,
  // Tools and CRM
  pdfscraper: false,
  quotation: false,
  leads: false,
  deals: false,
  reports: false,
  // System
  issues: false,
  // Finance — the whole company's money, so granted deliberately, never by default
  accounting: false,
  // The AI assistant. On for everyone: it reads only what the person's other
  // permissions already let them see, and every action it proposes is confirmed
  // by a person and gated by the permission the manual path needs.
  assistant: true,
  // Legacy flat flag, kept because normEmpPerms still reads it — see PERM_LEGACY
  viewAllRequests: false,
};

// ── Advanced permissions: per-action + data scope, for every section ──────────
// Backward compatible: legacy flat booleans (e.g. leads:true) normalize to full
// actions + no scope. The rich shape adds <section>Actions objects and a scope.
//
// An action earns its place here only if something actually enforces it — a route
// guard, a nav item or a button. A checkbox that governs nothing is worse than no
// checkbox, because the admin believes they have turned something off.
/** @type {Record<string, string[]>} */
const PERM_ACTIONS = {
  // Day to day
  requests: ['view', 'create', 'comment', 'viewAll'],
  // Weekly availability: seeing the team's week is the feature; setting your
  // own is separate so a display-only account can exist.
  availability: ['view', 'set'],
  tasks: ['view', 'create', 'edit', 'comment'],
  // Two nav items, one section: "Log Hours" writes, "Hours Log" reads. A rep who
  // must file their hours but should not read the team's gets log without view.
  hours: ['log', 'view'],
  // Google. `connect` is separate from `view` because connecting binds a personal
  // Google account to the workplace account — a different decision from browsing.
  drive: ['view', 'connect'],
  sheets: ['view'],
  email: ['view', 'send', 'connect'],
  calendar: ['view', 'connect'],
  // `view` lists scheduled meetings; `schedule` creates, reschedules and
  // cancels them (the calendar events follow). The page's join-a-code launcher
  // still needs no endpoint of ours.
  meet: ['view', 'schedule'],
  gchat: ['view', 'send'],
  // In-app chat. `edit`/`delete` are for one's own messages; huddles and uploads
  // are the two things a chat member can do that cost bandwidth or leave files.
  chat: ['view', 'send', 'edit', 'delete', 'upload', 'huddle'],
  // Inventory. Read-only from the portal: there is no stock page there, only the
  // vehicle picker in the lead and quotation forms and two Home widgets — which
  // were ungated, so every employee saw the company's stock counts on Home.
  // `view` is the vehicle picker and the Home stock widgets, and it is on by
  // default for everybody — it has been since before there was a page. `browse`
  // is the Inventory PAGE, which is a different question: the whole register,
  // every model, every price. It is granted, never inherited, so adding the page
  // did not hand it to the entire team on one deploy.
  // `tracking` is the container board — the whole logistics picture, including
  // where a customer's car is right now — so it is granted the same way `browse`
  // is rather than riding in on the section master. (`units` sat beside it for
  // the Vehicle register, which is gone: the cars live in the Models tab.)
  stock: ['view', 'browse', 'create', 'edit', 'tracking'],
  // Operations and procurement. The handlers are the dashboard's own, mounted a
  // second time under /api/employee — so these actions are the only difference
  // between what an employee may do here and what the admin may.
  suppliers: ['view', 'create', 'edit', 'delete', 'catalogue', 'docs', 'purchases'],
  rfq: ['view', 'create', 'edit', 'delete', 'export'],
  purchaseorders: ['view', 'create', 'edit', 'delete', 'export'],
  contracts: ['view', 'create', 'edit', 'delete', 'export'],
  // The website writes these; a person only reads one or bins it.
  submissions: ['view', 'delete'],
  // CRM
  // `clientFolder` is separate from edit on purpose: a client's Drive folder
  // holds passports and signed contracts, and who may open one is named per
  // folder on top of this grant (src/routes/client-folder.js).
  leads: ['view', 'create', 'edit', 'delete', 'import', 'export', 'clientFolder'],
  // The Deals page's Sales tab is its own grant: `sales` opens the tab,
  // `salesEdit` writes to it. The Pipeline tab is simply deals.view.
  // `payments` reads the ledger behind a sale, `paymentsEdit` records one. They
  // follow the Sales tab's own two grants: whoever could already see what a
  // customer owes can see how they paid it.
  deals: [
    'view',
    'create',
    'edit',
    'delete',
    'move',
    'sales',
    'salesEdit',
    'payments',
    'paymentsEdit',
  ],
  quotation: ['draft', 'history', 'settings', 'delete', 'attachLead'],
  // Each report is granted individually, so an employee can be given the leads
  // report without the revenue figures (or vice-versa). Reports always obey the
  // employee's data scope — they aggregate only rows that employee may see.
  reports: ['leads', 'sales', 'export'],
  // Finance. `view` opens the Accounting section and every read behind it —
  // overview, receivables, payables, the ledger, saved reports — and those
  // figures are COMPANY-WIDE, not scoped to the employee's own leads. `edit`
  // records, changes and removes expenses (payments stay under deals.*). `export`
  // is CSV and PDF. `ai` is the finance assistant: insights, chat and writing a
  // report's narrative, each of which spends the AI provider's quota.
  accounting: ['view', 'edit', 'export', 'ai'],
  // The assistant on every page. `chat` is the drawer and the insight cards —
  // reading and suggesting; `act` lets it propose actions (a follow-up, a task,
  // a status change) that the person confirms. Each action is ALSO gated by the
  // section permission the manual path needs (leads.edit, tasks.create, …), so
  // `act` widens nothing on its own.
  assistant: ['chat', 'act'],
  // System
  issues: ['view', 'resolve'],
};

// Where "the master switch is on" is the wrong default for an action, because the
// action used to be governed by a flag of its own. Without this, turning Requests
// on — which it is for everyone — would hand every employee the whole company's
// requests, since requests.viewAll would inherit the master's `true`.
/** @type {Record<string, (p: Record<string, any>) => boolean>} */
const PERM_LEGACY = {
  'requests.viewAll': p => p.viewAllRequests === true,
};

// What a saved actions object that LACKS a key means. The admin editor always
// writes explicit true/false for every action it knows, so a missing key can
// only mean "this employee was saved before the action existed" — and turning
// that into `false` would silently strip the whole team of a tab they use the
// day a new action ships. Each new action added to an existing section
// registers its inheritance here; most follow `view`, because a new sub-ability
// of a section someone could already see should stay visible to them.
/** @type {Record<string, (acts: Record<string, any>, p?: Record<string, any>) => boolean>} */
const PERM_ACTION_FALLBACK = {
  // Meet had no actions when these employees were saved; the section master was
  // the whole grant, so both new actions inherit it (true — the section gate in
  // empCan already refused anyone without the master).
  'meet.view': () => true,
  'meet.schedule': () => true,
  'availability.view': () => true,
  'availability.set': () => true,
  'deals.sales': acts => acts.view === true,
  'deals.salesEdit': acts => acts.edit === true,
  'suppliers.purchases': acts => acts.view === true,
  'deals.payments': acts => acts.sales === true,
  'deals.paymentsEdit': acts => acts.salesEdit === true,
};

// Actions that must never be inherited — not from a section master, not from a
// sibling. A client folder holds passports and signed contracts, so an employee
// record that predates the action gets it OFF and an admin turns it on
// deliberately. Everything else inherits, because a section granted before an
// action existed did mean "all of it".
/** @type {Set<string>} */
const PERM_ACTION_NEVER_INHERIT = new Set([
  'leads.clientFolder',
  'stock.browse',
  'stock.create',
  'stock.edit',
  // The register carries purchase cost, freight and customs — what each
  // vehicle actually cost the company — and tracking exposes the supplier
  // route. Neither should arrive on the day of a deploy for everyone who
  // happens to have Inventory switched on.
  'stock.tracking',
]);

// ── What the admin's editor renders ───────────────────────────────────────────
// Grouped and labelled next to the model rather than in dashboard.js, and served
// over an endpoint, so the editor is generated from the same list the server
// enforces. Add a section to PERM_ACTIONS and it appears in the admin UI; it
// cannot be forgotten there, and it cannot show up as a bare camelCase key.
/** @type {{ group: string, sections: string[] }[]} */
const PERM_GROUPS = [
  { group: 'Day to day', sections: ['requests', 'tasks', 'hours', 'availability'] },
  { group: 'Google', sections: ['drive', 'sheets', 'email', 'calendar', 'meet', 'gchat'] },
  { group: 'Chat', sections: ['chat'] },
  { group: 'Inventory', sections: ['stock'] },
  {
    group: 'Operations',
    sections: ['suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions'],
  },
  { group: 'Tools', sections: ['quotation'] },
  { group: 'CRM', sections: ['leads', 'deals', 'reports'] },
  { group: 'Finance', sections: ['accounting'] },
  { group: 'System', sections: ['issues', 'assistant'] },
];

/** @type {Record<string, string>} */
const PERM_SECTION_LABELS = {
  requests: 'Requests',
  tasks: 'My Tasks',
  hours: 'Hours',
  availability: 'Availability',
  drive: 'My Drive',
  sheets: 'My Sheets',
  email: 'My Email',
  calendar: 'Calendar',
  meet: 'Meet',
  gchat: 'Google Chat',
  chat: 'Team chat',
  quotation: 'Quotation',
  stock: 'Inventory',
  suppliers: 'Suppliers',
  rfq: 'RFQ',
  purchaseorders: 'Purchase orders',
  contracts: 'Sales contracts',
  submissions: 'Website submissions',
  leads: 'Leads',
  deals: 'Deals',
  reports: 'Reports',
  issues: 'Issues centre',
  accounting: 'Accounting',
  assistant: 'AI assistant',
};

// Keyed "section.action" where the plain word would mislead, and by the bare word
// otherwise. Reports has no generic actions at all — each one names a report.
/** @type {Record<string, string>} */
const PERM_ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  comment: 'Comment',
  connect: 'Connect account',
  send: 'Send',
  import: 'Import',
  export: 'Export',
  move: 'Move between stages',
  upload: 'Upload files',
  huddle: 'Start huddles',
  resolve: 'Resolve',
  draft: 'Draft quotations',
  history: 'Quotation history',
  settings: 'Quotation settings',
  attachLead: 'Attach to a lead',
  'requests.viewAll': "See everyone's requests",
  'hours.log': 'Log own hours',
  'hours.view': 'Read the hours log',
  'chat.edit': 'Edit own messages',
  'chat.delete': 'Delete own messages',
  'reports.leads': 'Leads report',
  'reports.sales': 'Sales & revenue report',
  'reports.export': 'Export report data',
  'quotation.delete': 'Delete quotations',
  'issues.view': 'Open the issues centre',
  'meet.view': 'See scheduled meetings',
  'meet.schedule': 'Schedule meetings',
  'availability.view': "See the team's week",
  'availability.set': 'Set own availability',
  'stock.view': 'Look vehicles up (picker and Home)',
  'stock.browse': 'Open the Inventory page',
  'stock.create': 'Add a vehicle',
  'stock.edit': 'Edit a vehicle',
  'stock.tracking': 'Container tracking',
  'suppliers.catalogue': 'Manage the vehicle catalogue',
  'suppliers.purchases': 'Purchases tab',
  'deals.sales': 'Sales tab',
  'deals.salesEdit': 'Edit sales records',
  'deals.payments': 'See payments',
  'deals.paymentsEdit': 'Record payments',
  'suppliers.docs': 'Supplier documents',
  'rfq.export': 'Export the Excel workbook',
  'purchaseorders.export': 'Generate the PDF',
  'contracts.export': 'Generate the PDF',
  'submissions.delete': 'Delete a submission',
  'leads.clientFolder': 'Client Drive folders',
  'accounting.view': 'Open Accounting (company-wide figures)',
  'accounting.edit': 'Record expenses',
  'accounting.export': 'Export CSV / PDF',
  'accounting.ai': 'Use the finance AI',
  'assistant.chat': 'Ask the assistant (insights and chat)',
  'assistant.act': 'Let it propose actions to confirm',
};

// Starting points, not roles. Twenty-two sections is a lot to tick one at a
// time for a new starter, and the honest shape of the job is "most of these,
// then a few adjustments" — so a preset fills the form and the admin edits from
// there; nothing is stored as "this person is a Sales rep".
//
// `sections` lists what the preset turns ON with all of its actions. `readOnly`
// lists sections granted with their read-ish actions only. Everything else is
// off. They live here, beside PERM_ACTIONS, because a preset naming a section
// that no longer exists should be visible in the same file that renamed it.
// `payments` is the read half of the ledger behind a sale, so a read-only
// grant of Deals sees how a customer paid, not only what they owe.
/** @type {string[]} */
const PERM_READISH = ['view', 'log', 'draft', 'history', 'leads', 'sales', 'payments', 'chat'];

/** @type {{ key: string, label: string, hint?: string, sections?: string[], readOnly?: string[], all?: boolean }[]} */
const PERM_PRESETS = [
  {
    key: 'sales',
    label: 'Sales rep',
    hint: 'Leads, deals and quotations, plus the everyday tools.',
    sections: [
      'requests',
      'tasks',
      'hours',
      'availability',
      'chat',
      'meet',
      'calendar',
      'email',
      'drive',
      'quotation',
      'leads',
      'deals',
      'assistant',
    ],
    readOnly: ['stock', 'contracts', 'reports'],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    hint: 'Suppliers, RFQs and purchase orders end to end.',
    sections: [
      'requests',
      'tasks',
      'hours',
      'availability',
      'chat',
      'meet',
      'calendar',
      'email',
      'drive',
      'suppliers',
      'rfq',
      'purchaseorders',
      'stock',
      'assistant',
    ],
    readOnly: ['leads', 'contracts'],
  },
  {
    key: 'ops',
    label: 'Operations',
    hint: 'Contracts, submissions and the paperwork around a sale.',
    sections: [
      'requests',
      'tasks',
      'hours',
      'availability',
      'chat',
      'meet',
      'calendar',
      'email',
      'drive',
      'sheets',
      'contracts',
      'submissions',
      'stock',
      'assistant',
    ],
    readOnly: ['leads', 'deals', 'rfq', 'purchaseorders'],
  },
  {
    key: 'accountant',
    label: 'Accountant',
    hint: 'Money in, money out, expenses and the finance AI.',
    sections: [
      'requests',
      'tasks',
      'hours',
      'availability',
      'chat',
      'meet',
      'calendar',
      'email',
      'drive',
      'sheets',
      'accounting',
      'assistant',
    ],
    readOnly: ['deals', 'contracts', 'purchaseorders', 'reports'],
  },
  {
    key: 'readonly',
    label: 'Read-only',
    hint: 'Can see the work, cannot change it.',
    sections: ['requests', 'tasks', 'chat'],
    readOnly: [
      'leads',
      'deals',
      'stock',
      'suppliers',
      'rfq',
      'purchaseorders',
      'contracts',
      'submissions',
      'reports',
      'quotation',
      'availability',
      'meet',
      'hours',
      'assistant',
    ],
  },
  { key: 'everything', label: 'Full access', hint: 'Every section, every action.', all: true },
  { key: 'none', label: 'No access', hint: 'Start from nothing and build up.', sections: [] },
];

module.exports = {
  DEFAULT_PERMISSIONS,
  PERM_ACTIONS,
  PERM_LEGACY,
  PERM_ACTION_FALLBACK,
  PERM_ACTION_NEVER_INHERIT,
  PERM_GROUPS,
  PERM_SECTION_LABELS,
  PERM_ACTION_LABELS,
  PERM_READISH,
  PERM_PRESETS,
};
