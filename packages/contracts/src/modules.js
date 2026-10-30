'use strict';
// The screens of the app: which there are, who gets each one, where each sits in the navigation, and what each
// was called in the classic portals. One list for the web app's navigation and routes, the server's redirects and
// the tests that hold all of them to the classic portals.
//
// A screen ("module") is the same screen for the admin and for the team: what differs between the portals today —
// the name the rail gives it, its icon, where in the rail it stands — is presentation, kept beside the screen
// (`team`) and in each portal's own rail (NAV), so the new app can match the classic look now and unify later.
// Who gets a screen is not presentation: `needs` is the one question, asked of the one actor, by the one `can()`.
//
// The classic ids are kept (`legacy`) because they are still how things are stored and linked: the shared sidebar
// arrangement (nav_config) and each person's favourites name classic pages, notifications carry '/employee#requests',
// and a service worker opens '/dashboard?chat='. Until the classic portals are gone the new app reads all of them.

const { can, hasSection } = require('./access');

/**
 * What a screen needs of the person asking.
 *  always    nobody is locked out of it
 *  section   the section's master switch is on (hasSection)
 *  cap       one action (`stock.browse`)
 *  anyCap    one of several actions (Hours is the log and the form: either opens the page)
 *  admin     the administrator only — until it becomes a permission an admin can hand out
 * @typedef {{ kind: 'always' }
 *   | { kind: 'section', section: string }
 *   | { kind: 'cap', cap: string }
 *   | { kind: 'anyCap', caps: readonly string[] }
 *   | { kind: 'admin' }} Needs
 *
 * @typedef {'management' | 'crm' | 'finance' | 'logistics' | 'integrations' | 'chat' | 'google' | 'system'} GroupId
 * @typedef {'admin' | 'team'} Portal
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   icon: string,
 *   needs: Needs,
 *   flag?: string,
 *   portals: readonly Portal[],
 *   fresh?: readonly Portal[],
 *   team?: { label?: string, icon?: string, title?: string },
 *   legacy?: { admin?: string, team?: string },
 * }} Screen
 */

/** The rail's sections, in the order the classic portals draw them. (Their own order can be rearranged by the admin.) */
const GROUPS = /** @type {const} */ ([
  { id: 'management', label: 'Management' },
  { id: 'crm', label: 'CRM' },
  { id: 'finance', label: 'Finance' },
  { id: 'logistics', label: 'Logistics & Shipping' },
  { id: 'integrations', label: 'Tools' },
  { id: 'chat', label: 'Chat' },
  { id: 'google', label: 'Google' },
  { id: 'system', label: 'System' },
]);

const always = /** @type {const} */ ({ kind: 'always' });
const admin = /** @type {const} */ ({ kind: 'admin' });
/** @param {string} section */
const section = section => /** @type {const} */ ({ kind: 'section', section });
/** @param {string} cap */
const cap = cap => /** @type {const} */ ({ kind: 'cap', cap });
/** @param {...string} caps */
const anyCap = (...caps) => /** @type {const} */ ({ kind: 'anyCap', caps });

const BOTH = /** @type {const} */ (['admin', 'team']);
const ADMIN = /** @type {const} */ (['admin']);

// The label and icon here are the admin portal's; where the team portal's differ, `team` says how. A screen that is
// only in the team portal carries the team's. `legacy` names the classic page where it is not the screen's own id.
// `fresh` names the portals where the screen exists only in the new app: the classic portal has no page for it, so
// the app must have a module for it (there is nothing to frame), and nothing that speaks of classic pages names it.
const SCREENS = /** @type {const} */ ([
  { id: 'home', label: 'Home', icon: 'layout-dashboard', needs: always, portals: BOTH },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'clipboard-list',
    needs: section('tasks'),
    portals: BOTH,
    team: { label: 'My Tasks' },
  },
  { id: 'employees', label: 'Employees', icon: 'users', needs: admin, portals: ADMIN },
  { id: 'requests', label: 'Requests', icon: 'inbox', needs: section('requests'), portals: BOTH },
  {
    id: 'hours',
    label: 'Hours Logs',
    icon: 'clock',
    needs: anyCap('hours.log', 'hours.view'),
    portals: BOTH,
    team: { label: 'Hours Log', icon: 'bar-chart-3' },
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: 'trash-2',
    needs: admin,
    portals: ADMIN,
    legacy: { admin: 'deletions' },
  },

  {
    id: 'leads',
    label: 'Leads',
    icon: 'contact-2',
    needs: section('leads'),
    portals: BOTH,
    legacy: { admin: 'customers' },
  },
  { id: 'deals', label: 'Deals', icon: 'kanban-square', needs: section('deals'), portals: BOTH },
  {
    id: 'submissions',
    label: 'Submissions',
    icon: 'mail',
    needs: section('submissions'),
    portals: BOTH,
    team: { icon: 'clipboard-check', title: 'Website Submissions' },
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'bar-chart-3',
    needs: anyCap('reports.leads', 'reports.sales'),
    portals: BOTH,
  },
  { id: 'automations', label: 'Automations', icon: 'workflow', needs: admin, portals: ADMIN },

  {
    id: 'accounting',
    label: 'Accounting',
    icon: 'brain-ai',
    needs: section('accounting'),
    portals: BOTH,
  },

  {
    id: 'stock',
    label: 'Inventory & Logistics',
    icon: 'car-front',
    needs: cap('stock.browse'),
    portals: BOTH,
    team: { label: 'Inventory', icon: 'car' },
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    icon: 'factory',
    needs: section('suppliers'),
    portals: BOTH,
  },

  {
    id: 'quotation',
    label: 'Quotation',
    icon: 'file-badge',
    needs: section('quotation'),
    portals: BOTH,
  },
  {
    id: 'contracts',
    label: 'Contract',
    icon: 'file-signature',
    needs: section('contracts'),
    portals: BOTH,
    team: { label: 'Contracts' },
  },
  {
    id: 'rfq',
    label: 'RFQ',
    icon: 'file-search',
    needs: section('rfq'),
    portals: BOTH,
    team: { icon: 'send' },
    legacy: { admin: 'rfqs' },
  },
  {
    id: 'purchaseorders',
    label: 'Purchase Orders',
    icon: 'shopping-cart',
    needs: section('purchaseorders'),
    portals: BOTH,
  },

  { id: 'chat', label: 'Chat', icon: 'message-circle', needs: section('chat'), portals: BOTH },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'message-square-text', needs: admin, portals: ADMIN },

  {
    id: 'calendar',
    label: 'Calendar',
    icon: 'calendar',
    needs: section('calendar'),
    portals: BOTH,
  },
  { id: 'meet', label: 'Meet', icon: 'video', needs: section('meet'), portals: BOTH },
  // Present in the rail only where the server says Google Chat is set up (the `gchat` flag of /api/v1/me).
  {
    id: 'gchat',
    label: 'Google Chat',
    icon: 'message-square',
    needs: section('gchat'),
    flag: 'gchat',
    portals: BOTH,
  },
  { id: 'email', label: 'My Email', icon: 'mail', needs: section('email'), portals: BOTH },
  { id: 'drive', label: 'My Drive', icon: 'hard-drive', needs: section('drive'), portals: BOTH },
  { id: 'sheets', label: 'My Sheets', icon: 'table', needs: section('sheets'), portals: BOTH },

  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'bell',
    needs: always,
    portals: BOTH,
    legacy: { admin: 'notif', team: 'notif' },
  },
  { id: 'workspace', label: 'Workspace', icon: 'palette', needs: admin, portals: ADMIN },
  {
    id: 'issues',
    label: 'Issues',
    icon: 'bug',
    needs: section('issues'),
    portals: BOTH,
    fresh: ADMIN,
  },

  // Not in the rail: reached from the footer (admin) or the profile menu (team), and by '#security' links.
  { id: 'security', label: 'Security', icon: 'shield-check', needs: always, portals: BOTH },
]);

/**
 * Each portal's rail: the sections it draws, and the screens in each, in the order the classic page has them.
 * @type {Record<Portal, readonly { group: GroupId, items: readonly string[] }[]>}
 */
const NAV = {
  admin: [
    {
      group: 'management',
      items: ['home', 'tasks', 'employees', 'requests', 'hours', 'approvals'],
    },
    { group: 'crm', items: ['leads', 'deals', 'submissions', 'reports', 'automations'] },
    { group: 'finance', items: ['accounting'] },
    { group: 'logistics', items: ['stock', 'suppliers'] },
    { group: 'integrations', items: ['quotation', 'contracts', 'rfq', 'purchaseorders'] },
    { group: 'chat', items: ['chat', 'whatsapp'] },
    { group: 'google', items: ['calendar', 'meet', 'gchat', 'email', 'drive', 'sheets'] },
    { group: 'system', items: ['notifications', 'issues', 'workspace'] },
  ],
  team: [
    { group: 'management', items: ['home', 'tasks', 'hours', 'requests'] },
    { group: 'crm', items: ['leads', 'deals', 'submissions', 'reports'] },
    { group: 'finance', items: ['accounting'] },
    { group: 'logistics', items: ['stock', 'suppliers'] },
    { group: 'integrations', items: ['quotation', 'contracts', 'rfq', 'purchaseorders'] },
    { group: 'chat', items: ['chat'] },
    { group: 'google', items: ['calendar', 'meet', 'gchat', 'email', 'drive', 'sheets'] },
    { group: 'system', items: ['notifications', 'issues'] },
  ],
};

/** The four quick tabs along the bottom of a phone, before "More". */
const BOTTOM_NAV = {
  admin: [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'tasks', label: 'Tasks', icon: 'clipboard-list' },
    { id: 'leads', label: 'Leads', icon: 'users' },
    { id: 'chat', label: 'Chat', icon: 'message-square' },
  ],
  team: [
    { id: 'home', label: 'Home', icon: 'layout-dashboard' },
    { id: 'tasks', label: 'Tasks', icon: 'clipboard-list' },
    { id: 'hours', label: 'Hours', icon: 'bar-chart-3' },
    { id: 'requests', label: 'Requests', icon: 'inbox' },
  ],
};

/** @type {ReadonlyMap<string, Screen>} */
const BY_ID = new Map(SCREENS.map(s => [s.id, /** @type {Screen} */ (s)]));

/**
 * @param {string} id
 * @returns {Screen | undefined}
 */
function screenOf(id) {
  return BY_ID.get(id);
}

/**
 * Is this screen in that portal at all?
 * @param {Screen} screen
 * @param {Portal} portal
 * @returns {boolean}
 */
function inPortal(screen, portal) {
  return /** @type {readonly Portal[]} */ (screen.portals).includes(portal);
}

/**
 * Is this screen new to that portal: in the new app only, with no classic page behind it?
 * @param {Screen} screen
 * @param {Portal} portal
 * @returns {boolean}
 */
function isNewTo(screen, portal) {
  return !!screen.fresh && /** @type {readonly Portal[]} */ (screen.fresh).includes(portal);
}

/**
 * What a portal calls a screen: the label and the icon its rail shows, and the title its page carries (the team portal's
 * top bar names the page; it is the label except where the classic page says otherwise).
 * @param {Screen} screen
 * @param {Portal} portal
 * @returns {{ label: string, icon: string, title: string }}
 */
function presentation(screen, portal) {
  const over = portal === 'team' ? screen.team : undefined;
  const label = (over && over.label) || screen.label;
  return { label, icon: (over && over.icon) || screen.icon, title: (over && over.title) || label };
}

/**
 * The classic portal's name for a screen ('customers' for Leads in the admin portal).
 * @param {Screen} screen
 * @param {Portal} portal
 * @returns {string}
 */
function legacyIdOf(screen, portal) {
  return (screen.legacy && screen.legacy[portal]) || screen.id;
}

/**
 * Which screen a classic page id is, in a portal. The old team key for the hours page ('log') is still in saved
 * hashes, favourites and notification links; screens answer to their own id too, so a link that already speaks the
 * new vocabulary lands on the right screen. Nothing else is guessed: an id that is none of these is no screen.
 * @param {string} legacyId
 * @param {Portal} portal
 * @returns {string | null}
 */
function screenIdFromLegacy(legacyId, portal) {
  const id = String(legacyId || '');
  if (id === 'log' && portal === 'team') return 'hours';
  for (const s of SCREENS) {
    if (!inPortal(s, portal)) continue;
    if (legacyIdOf(s, portal) === id || s.id === id) return s.id;
  }
  return null;
}

/**
 * Does this person get this screen? Asked of the actor the server describes at /api/v1/me (or built from it) and the
 * flags that came with it. A flag a screen names must be on, for everyone: the classic rail hides Google Chat until the
 * server says it is set up, for the admin too.
 * @param {import('./access').Actor | null | undefined} actor
 * @param {Screen} screen
 * @param {Record<string, boolean> | undefined} [flags]
 * @returns {boolean}
 */
function allows(actor, screen, flags) {
  if (!actor) return false;
  if (screen.flag && !(flags && flags[screen.flag] === true)) return false;
  const n = screen.needs;
  switch (n.kind) {
    case 'always':
      return true;
    case 'admin':
      return actor.kind === 'admin';
    case 'section':
      return hasSection(actor, n.section);
    case 'cap':
      return can(actor, n.cap);
    case 'anyCap':
      return n.caps.some(c => can(actor, c));
    default:
      return false;
  }
}

module.exports = {
  GROUPS,
  SCREENS,
  NAV,
  BOTTOM_NAV,
  screenOf,
  inPortal,
  isNewTo,
  presentation,
  legacyIdOf,
  screenIdFromLegacy,
  allows,
};
