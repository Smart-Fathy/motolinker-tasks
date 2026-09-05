// One Drive folder per client, with the paperwork already in it.
//
// Every document this company produces for a lead — quotations, RFQs, purchase
// orders, contracts — is already stored against that lead, but only as rows in
// Postgres reachable through the dashboard. When somebody needs to send a client
// their file, or a colleague wants the paperwork without a login, it has to be
// re-generated one PDF at a time. This makes the folder that should have existed
// all along: MotoLinker / Clients / <name> — <phone>, containing a PDF of every
// document attached to the lead.
//
// Two rules shape the design:
//
//   Syncing is idempotent. The button can be pressed any number of times; each
//   document is uploaded once and remembered by id in customers.client_folder,
//   so pressing it again only picks up what is new. Re-uploading would litter
//   the folder with "Quotation Q-2026-014.pdf" seven times over.
//
//   Seeing the folder is a decision, not a side effect of having leads access.
//   A client folder holds passports and signed contracts. The admin names the
//   people who may open each one; everyone else — including employees who hold
//   leads.clientFolder and can see the lead itself — gets the section without a
//   link. Admins always have access, because somebody must.
//
// The PDFs are rendered by the very functions the /pdf endpoints use, so a
// change to a document's layout reaches the folder with nothing to keep in step.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need(
  'express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);
const logLeadActivity = (...a) => ctx.logLeadActivity(...a);

const CLIENTS_FOLDER = 'Clients';
// Drive is happy with most characters; these are the ones that make a folder
// name unreadable or unsearchable once it is sitting in a list of hundreds.
function clientFolderName(customer) {
  const name = String(customer.name || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  const phone = String(customer.phone || '').replace(/[\\/:*?"<>|]/g, '').trim();
  const label = [name || 'Unnamed lead', phone].filter(Boolean).join(' — ');
  return label.slice(0, 120);
}

// The stored shape. `docs` is keyed "<type>:<id>" so a second sync can tell what
// it has already uploaded without asking Drive (which would need a list call per
// document, and would still be wrong the moment somebody renames a file).
function emptyFolder() { return { id: '', link: '', name: '', docs: {}, viewers: [], created_at: null }; }
function readFolder(customer) {
  const f = customer && customer.client_folder;
  return f && typeof f === 'object' ? { ...emptyFolder(), ...f } : emptyFolder();
}

// Admins always. An employee needs the grant AND to be named on this folder:
// the grant says "this person handles client paperwork", the list says "…for
// these clients". An empty list is therefore admins-only, not everyone.
function mayOpen(req, folder) {
  if (!req.employee) return true;
  const id = req.employee.id;
  return (folder.viewers || []).some(v => String(v) === String(id));
}

// What the caller is allowed to know. Somebody who may not open the folder still
// sees that it exists and how much is in it — hiding that only produces a second
// folder made by somebody who could not tell.
function folderView(req, folder) {
  const count = Object.keys(folder.docs || {}).length;
  const base = { exists: !!folder.id, name: folder.name, documents: count,
                 created_at: folder.created_at, viewers: folder.viewers || [] };
  return mayOpen(req, folder) ? { ...base, link: folder.link, canOpen: true } : { ...base, link: '', canOpen: false };
}

async function loadCustomer(id) {
  const { data, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data;
}

// customers.client_folder arrives with migration 013. A deploy can land before
// the SQL does, and when it does the honest answer is "the folder cannot be
// remembered yet", not a 500 with a Postgres error in it.
const MIGRATION_MSG = 'The client folder needs migrations/013_client_folder.sql applied to the database first.';
function isMissingColumn(err) {
  const m = String((err && (err.message || err.details)) || '');
  return /client_folder/.test(m) && (/does not exist|could not find/i.test(m)
    || err.code === '42703' || err.code === 'PGRST204');
}
async function saveFolder(customerId, folder) {
  const { error } = await supabase.from('customers')
    .update({ client_folder: folder }).eq('id', customerId);
  if (error) {
    const e = new Error(isMissingColumn(error) ? MIGRATION_MSG : error.message);
    e.status = isMissingColumn(error) ? 409 : 500;
    throw e;
  }
}

// ── What belongs in the folder ────────────────────────────────────────────────
// One entry per document: how to find it, what to call the file, and how to turn
// it into a PDF — always through the same builder the /pdf route uses.
async function docSettings() {
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const r of data || []) settings[r.key] = r.value;
  return settings;
}
const DOC_TYPES = {
  quotation: {
    table: 'quotations', label: 'Quotation',
    name: r => `Quotation ${r.quote_id || r.id}`,
    html: async (r, settings) => {
      const d = r.data || {};
      return ctx.buildQuotationHtml({ ...d, template: ctx.quoteTheme(d.template).key, settings });
    },
  },
  rfq: {
    table: 'rfqs', label: 'RFQ',
    name: r => `RFQ ${r.rfq_no || r.id}`,
    html: async (r, settings) => ctx.buildRfqHtml({ ...r, settings }),
  },
  po: {
    table: 'purchase_orders', label: 'Purchase order',
    name: r => `PO ${r.po_number || r.id}`,
    html: async (r, settings) => ctx.buildPurchaseOrderHtml({ ...r, client_name: await ctx.poClientName(r), settings }),
  },
  contract: {
    table: 'contracts', label: 'Contract',
    name: r => `Contract ${r.contract_no || r.id}`,
    html: async r => ctx.buildContractHtml(r.data || {}),
  },
};

async function docsForCustomer(customerId) {
  const out = [];
  for (const [type, spec] of Object.entries(DOC_TYPES)) {
    const { data } = await supabase.from(spec.table).select('*')
      .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100);
    (data || []).forEach(row => out.push({ type, spec, row, key: `${type}:${row.id}` }));
  }
  return out;
}

// ── Create and sync ───────────────────────────────────────────────────────────
async function syncClientFolder(customer) {
  const token = await ctx.driveAdminToken();
  const folder = readFolder(customer);
  const wanted = clientFolderName(customer);

  // MotoLinker / Clients / <this client>
  const clientsRoot = await ctx.driveEnsureFolder(token, CLIENTS_FOLDER);
  if (!folder.id) {
    folder.id = await ctx.driveFindOrCreateFolder(token, wanted, clientsRoot);
    folder.link = `https://drive.google.com/drive/folders/${folder.id}`;
    folder.created_at = new Date().toISOString();
  }
  folder.name = wanted;

  const settings = await docSettings();
  const docs = await docsForCustomer(customer.id);
  const added = [];
  const failed = [];
  for (const d of docs) {
    if (folder.docs[d.key]) continue;                       // already up there
    try {
      const html = await d.spec.html(d.row, settings);
      const pdf = await ctx.renderQuotationPdf(html);
      const name = `${d.spec.name(d.row)}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
      const f = await ctx.driveUploadFile(token, {
        buffer: Buffer.from(pdf), name, mimeType: 'application/pdf', folderId: folder.id,
      });
      folder.docs[d.key] = { fileId: f.id, name, link: f.webViewLink || '', at: new Date().toISOString() };
      added.push(name);
    } catch (e) {
      // One unrenderable document must not cost the client the other twelve.
      console.error('[client-folder] ' + d.key, e.message);
      failed.push(`${d.spec.label} ${d.row.id}`);
    }
  }
  return { folder, added, failed, total: docs.length };
}

// ── Routes ────────────────────────────────────────────────────────────────────
// Mounted for both portals over one set of handlers, like every other document
// area — see src/routes/contracts.js for why.
function mountClientFolderRoutes(base, guard) {
  receiver.router.get(`${base}/:id/folder`, guard, requirePerm('leads', 'clientFolder'), async (req, res) => {
    const customer = await loadCustomer(parseInt(req.params.id));
    if (!customer) return res.status(404).json({ error: 'Lead not found' });
    res.json(folderView(req, readFolder(customer)));
  });

  receiver.router.post(`${base}/:id/folder`, guard, requirePerm('leads', 'clientFolder'),
  express.json(), async (req, res) => {
    const customer = await loadCustomer(parseInt(req.params.id));
    if (!customer) return res.status(404).json({ error: 'Lead not found' });
    try {
      const { folder, added, failed, total } = await syncClientFolder(customer);
      await saveFolder(customer.id, folder);
      const who = callerIdentity(req);
      if (added.length) {
        logLeadActivity(customer.id, {
          type: 'note',
          body: `Client folder ${folder.created_at && !total ? 'created' : 'updated'} — ${added.length} document(s) filed to Drive`,
          meta: { client_folder: folder.id }, authorKey: who.key, authorName: who.name,
        });
      }
      res.json({ ...folderView(req, folder), added, failed });
    } catch (e) {
      res.status(e.status || ctx.driveErrStatus(e)).json({ error: ctx.driveErrMessage(e) });
    }
  });
}
mountClientFolderRoutes('/api/dashboard/customers', requireAuth);
mountClientFolderRoutes('/api/employee/leads', requireEmployeeAuth);

// Who may open it is the admin's call alone — an employee cannot add themselves
// to a folder, which is the whole point of the list.
receiver.router.put('/api/dashboard/customers/:id/folder/viewers', requireAuth, express.json(), async (req, res) => {
  const customer = await loadCustomer(parseInt(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Lead not found' });
  const ids = Array.isArray(req.body?.viewers) ? req.body.viewers : [];
  const folder = readFolder(customer);
  folder.viewers = [...new Set(ids.map(v => parseInt(v)).filter(Number.isFinite))].slice(0, 100);
  try {
    await saveFolder(customer.id, folder);
    res.json(folderView(req, folder));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = { clientFolderName, folderView, mayOpen, readFolder };
