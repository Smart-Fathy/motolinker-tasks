// The portals, opened on realistic data, for the tools that look at every screen (the parity
// photographs, and in time the contrast audit and the golden record): the in-memory database seeded
// from schema.sql, a conversation in a group chat, leads in every status the product ships plus a few
// awkward colours, an admin session, and a team member who may open every page.
//
// "May open every page" has to be said on the employee's ROW as well as on the session: the portal's
// first /check rebuilds the session from the row, and a row with no permissions leaves leads, deals,
// suppliers, rfq, reports … switched off — those pages then bounce to Home, and a tool that
// navigates to them photographs Home under their name.
const path = require('path');
const { createFakeSupabase, bootApp } = require('./fake-supabase');
const { parseSchema, seedTables } = require('./seed');

const at = m => new Date(Date.UTC(2026, 2, 4, 9, m)).toISOString();

// [key, label, colour]: the six statuses the product ships, then white, pale yellow, cyan, lime, hot pink.
const LEAD_STATUSES = [
  ['cold', 'Cold', '#b9b3a4'], ['warm', 'Warm', '#e69650'], ['hot', 'Hot', '#f87171'],
  ['immediate_delivery', 'Immediate Delivery', '#6dd8a4'], ['not_interested', 'Not Interested', '#888888'],
  ['blacklist', 'Blacklist', '#dc2626'], ['vip', 'VIP', '#ffffff'], ['sunny', 'Sunny', '#ffe066'],
  ['ice', 'Ice', '#00e5ff'], ['lime', 'Lime', '#c6ff3d'], ['pink', 'Pink', '#ff2bd6'],
];

function seedDemoData(db) {
  db.tables.chat_rooms = [{ id: 1, type: 'group', name: 'Showroom', created_by: 'admin', created_at: at(0), updated_at: at(9) }];
  db.tables.chat_room_members = [
    { room_id: 1, member_key: 'admin', member_name: 'Admin', joined_at: at(0) },
    { room_id: 1, member_key: 'employee_1', member_name: 'Admin Person', joined_at: at(0) },
  ];
  db.tables.chat_messages = [
    { id: 1, room_id: 1, sender_key: 'admin', sender_name: 'Admin', body: 'Morning team — the new stock arrives today.', created_at: at(1) },
    { id: 2, room_id: 1, sender_key: 'employee_1', sender_name: 'Admin Person', body: 'Great. I will check the paperwork: https://example.com/shipment/42', created_at: at(2) },
    { id: 3, room_id: 1, sender_key: 'admin', sender_name: 'Admin', body: 'Thanks! Please tell me if anything is missing.', created_at: at(3) },
  ];
  db.tables.quotation_settings = (db.tables.quotation_settings || []).filter(r => r.key !== 'leads_columns_config').concat([{
    key: 'leads_columns_config',
    value: JSON.stringify([{ key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true,
      options: LEAD_STATUSES.map(([key, label, color]) => ({ key, label, color })) }]),
  }]);
  const first = db.tables.customers[0];
  db.tables.customers = LEAD_STATUSES.map(([key], i) => ({
    ...first, id: i + 1, name: 'Lead ' + (i + 1),
    phone: '+97155000' + String(i + 10), phone_norm: '+97155000' + String(i + 10), lead_status: key,
  }));
  const change = (id, from, to, m) => ({ id, customer_id: 1, type: 'status_change', body: 'Status changed', meta: { from, to }, author_key: 'admin', author_name: 'Admin', created_at: at(m) });
  db.tables.lead_activities = [change(1, 'cold', 'vip', 5), change(2, 'vip', 'sunny', 6), change(3, 'sunny', 'ice', 7), change(4, 'ice', 'hot', 8)];
}

// Every permission on, in the rich shape the portal reads (a section flag and its actions).
function allPermissions(normEmpPerms, PERM_ACTIONS) {
  const on = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') on[k] = true;
  for (const [section, actions] of Object.entries(PERM_ACTIONS || {})) on[section + 'Actions'] = Object.fromEntries(actions.map(a => [a, true]));
  return on;
}

// Boots the app on the demo data. Returns { base, db, portals: [{ who, route, key, token }] }.
async function bootDemo({ port, tokens = { admin: 'demo-admin', team: 'demo-employee' } } = {}) {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  seedDemoData(db);
  const base = await bootApp({ port });
  const ctx = require(path.join(__dirname, '..', '..', 'src', 'ctx'));
  const { normEmpPerms, PERM_ACTIONS } = require(path.join(__dirname, '..', '..', 'src', 'routes', 'employee-portal.js'));
  const everything = allPermissions(normEmpPerms, PERM_ACTIONS);
  db.tables.employees = db.tables.employees.map(e => (e.id === 1 ? { ...e, permissions: everything } : e));
  ctx.sessions.set(tokens.admin, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(tokens.team, { id: 1, name: 'Admin Person', username: 'smoke', job_title: 'Chief Technical Officer', permissions: normEmpPerms(everything), createdAt: Date.now() });
  return {
    base, db,
    portals: [
      { who: 'admin', route: '/dashboard', key: 'ml_admin_token', token: tokens.admin },
      { who: 'team', route: '/employee', key: 'ml_emp_token', token: tokens.team },
    ],
  };
}

module.exports = { bootDemo, seedDemoData, allPermissions, LEAD_STATUSES };
