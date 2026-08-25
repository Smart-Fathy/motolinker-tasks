// Column configuration for every configurable entity — the server half of the
// ClickUp-style field system. src/ctx.js explains the context object.
//
// One registry answers three questions per entity: where its config lives (a
// quotation_settings row), which permission governs READING it from the team
// portal, and nothing else — the builtins that seed an empty config live with
// the renderers in public/assets/columns.js, because they are display defaults,
// not data. Leads keep their historic KV key so nothing existing migrates.
//
// Writing is the admin's except for leads, which employees with leads.edit have
// always been able to arrange; that stays. sanitizeColumns runs on every write,
// so a hand-crafted PUT cannot smuggle in an unknown type, an uncolored option
// disguised as one, or a "builtin" the entity never had.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const empCan = (...a) => ctx.empCan(...a);

// Two kinds of entity live here. A `*_items` or table entity configures the
// COLUMNS of a grid; a `*_doc` entity configures the fields in a document's own
// header — the RFQ's Status, the PO's issuer block — which are as much "fields"
// to the person filling the form as the line-item columns are.
const ENTITY_COLUMNS = {
  leads:     { kvKey: 'leads_columns_config',     perm: 'leads',          empEdit: 'edit' },
  sales:     { kvKey: 'columns_config:sales',     perm: 'deals' },
  po_items:  { kvKey: 'columns_config:po_items',  perm: 'purchaseorders' },
  po_doc:    { kvKey: 'columns_config:po_doc',    perm: 'purchaseorders' },
  rfq_items: { kvKey: 'columns_config:rfq_items', perm: 'rfq' },
  rfq_doc:   { kvKey: 'columns_config:rfq_doc',   perm: 'rfq' },
  suppliers: { kvKey: 'columns_config:suppliers', perm: 'suppliers' },
  supplier_vehicles: { kvKey: 'columns_config:supplier_vehicles', perm: 'suppliers' },
  contracts: { kvKey: 'columns_config:contracts', perm: 'contracts' },
  quote_doc: { kvKey: 'columns_config:quote_doc', perm: 'quotation' },
  stock:     { kvKey: 'columns_config:stock',     perm: 'stock' },
};

const COLUMN_TYPES = ['text', 'number', 'date', 'link', 'select', 'radio', 'checkbox', 'virtual'];

function sanitizeColumns(columns) {
  if (!Array.isArray(columns)) return null;
  const seen = new Set();
  return columns
    .filter(c => c && typeof c.key === 'string' && c.key && !seen.has(c.key) && seen.add(c.key))
    .slice(0, 60)
    .map(c => {
      const out = {
        key: String(c.key).slice(0, 60),
        label: String(c.label || c.key).slice(0, 80),
        type: COLUMN_TYPES.includes(c.type) ? c.type : 'text',
        builtin: c.builtin === true,
        visible: c.visible !== false,
      };
      if (c.deleted === true) out.deleted = true;
      if (c.required === true) out.required = true;
      const w = parseInt(c.width);
      if (w >= 40 && w <= 800) out.width = w;
      if (Array.isArray(c.options)) {
        out.options = c.options.slice(0, 40)
          .filter(o => o && o.key)
          .map(o => {
            const opt = { key: String(o.key).slice(0, 60), label: String(o.label || o.key).slice(0, 80) };
            if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) opt.color = o.color.toLowerCase();
            return opt;
          });
      }
      return out;
    });
}

async function readColumns(entity, res) {
  const ent = ENTITY_COLUMNS[entity];
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  const { data } = await supabase.from('quotation_settings').select('value').eq('key', ent.kvKey).single();
  let columns = null;
  try { if (data && data.value) columns = JSON.parse(data.value); } catch (_) {}
  res.json({ columns, entity });
}

async function writeColumns(entity, body, res) {
  const ent = ENTITY_COLUMNS[entity];
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  const columns = sanitizeColumns(body && body.columns);
  if (!columns) return res.status(400).json({ error: 'columns must be an array' });
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: ent.kvKey, value: JSON.stringify(columns) }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, columns });
}

receiver.router.get('/api/dashboard/columns/:entity', requireAuth,
  (req, res) => readColumns(req.params.entity, res));
receiver.router.put('/api/dashboard/columns/:entity', requireAuth, express.json({ limit: '256kb' }),
  (req, res) => writeColumns(req.params.entity, req.body, res));

receiver.router.get('/api/employee/columns/:entity', requireEmployeeAuth, (req, res) => {
  const ent = ENTITY_COLUMNS[req.params.entity];
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  // Leads keep their historic carve-out: the quotation's attach-a-lead picker
  // needs the column config to label its options without the leads section.
  const allowed = req.params.entity === 'leads'
    ? (empCan(req.employee, 'leads', 'view') || empCan(req.employee, 'quotation', 'attachLead'))
    : empCan(req.employee, ent.perm, 'view');
  if (!allowed) return res.status(403).json({ error: 'Not permitted' });
  readColumns(req.params.entity, res);
});

receiver.router.put('/api/employee/columns/:entity', requireEmployeeAuth, express.json({ limit: '256kb' }), (req, res) => {
  const ent = ENTITY_COLUMNS[req.params.entity];
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  // Only leads are employee-arrangeable (leads.edit, as before). Everything else
  // is the admin's to shape.
  if (!ent.empEdit || !empCan(req.employee, ent.perm, ent.empEdit)) return res.status(403).json({ error: 'Not permitted' });
  writeColumns(req.params.entity, req.body, res);
});

module.exports = { ENTITY_COLUMNS, sanitizeColumns };
