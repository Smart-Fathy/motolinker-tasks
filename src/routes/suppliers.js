// Suppliers (Logistics & Shipping)
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);
const { GOOGLE_CLIENT_ID, crypto, express, getDriveToken, multer, receiver, requireAuth, requireEmployeeAuth, supabase, upload } = ctx.need('GOOGLE_CLIENT_ID', 'crypto', 'express', 'getDriveToken', 'multer', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'upload');
// Reassigned at runtime (Drive connect/disconnect, VAPID boot), so these are
// read from the context on use — capturing them here would pin the boot value.

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Suppliers (Logistics & Shipping) ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// The register behind the supplier pickers on RFQs, purchase orders and stock units.
function supplierBuildRow(body) {
  const b = body || {};
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Supplier name is required' };
  const row = {
    name,
    contact: String(b.contact || '').trim(),
    address: String(b.address || '').trim(),
    country: String(b.country || '').trim(),
    notes:   String(b.notes || '').trim(),
  };
  // Custom columns (the shared column engine) ride a JSONB blob, like leads.
  if (b.custom_fields && typeof b.custom_fields === 'object') row.custom_fields = b.custom_fields;
  return { row };
}

// Mounted for both portals over one set of handlers — see contracts.js for why.
// The catalogue, documents and purchase history in supplier-catalogue.js hang off
// the same base and are mounted from there by the same pair of calls.
function mountSupplierRoutes(base, guard) {
  receiver.router.get(base, guard, requirePerm('suppliers', 'view'), async (_req, res) => {
    const { data, error } = await supabase.from('suppliers').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  receiver.router.post(base, guard, requirePerm('suppliers', 'create'), express.json(), async (req, res) => {
    const { row, error: verr } = supplierBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.created_by = callerIdentity(req).key;
    const { data, error } = await supabase.from('suppliers').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('suppliers', 'edit'), express.json(), async (req, res) => {
    const { row, error: verr } = supplierBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('suppliers').update(row).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('suppliers', 'delete'), async (req, res) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  ctx.mountSupplierCatalogueRoutes(base, guard);
}

// ── Drive uploads ─────────────────────────────────────────────────────────────
// Client files and supplier paperwork go to Google Drive rather than Supabase
// Storage: the free Supabase tier is 1 GB total with capped egress, and a handful
// of scanned passports and shipping documents would eat it. Workspace Drive is
// effectively unlimited. Small chat attachments stay in Supabase — they already
// work and are nowhere near the limit.
const DRIVE_ROOT_FOLDER = 'MotoLinker';
const _driveFolders = new Map();   // 'MotoLinker/Client Files' -> folderId

async function driveFindOrCreateFolder(token, name, parentId) {
  const safe = String(name).replace(/'/g, "\\'");
  const q = [
    `name='${safe}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(' and ');
  // canAddChildren, because the two Drive scopes see different things: readonly lists
  // every folder in the account, drive.file may only write to folders this app made.
  // A "MotoLinker" folder the user created by hand is therefore findable and yet
  // unwritable, and uploading into it 403s. Skip those and make our own instead.
  const look = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,capabilities/canAddChildren)&pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` } });
  const found = await look.json();
  if (found.error) throw new Error(found.error.message);
  const writable = (found.files || []).find(f => !f.capabilities || f.capabilities.canAddChildren !== false);
  if (writable) return writable.id;

  const made = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  const created = await made.json();
  if (created.error) throw new Error(created.error.message);
  return created.id;
}

// 'Client Files' -> MotoLinker/Client Files, created on first use and then cached
async function driveEnsureFolder(token, sub) {
  const cacheKey = `${DRIVE_ROOT_FOLDER}/${sub}`;
  if (_driveFolders.has(cacheKey)) return _driveFolders.get(cacheKey);
  const root = await driveFindOrCreateFolder(token, DRIVE_ROOT_FOLDER, null);
  const id = await driveFindOrCreateFolder(token, sub, root);
  _driveFolders.set(cacheKey, id);
  return id;
}

// Multipart upload: metadata part, then the bytes, in one request.
async function driveUploadFile(token, { buffer, name, mimeType, folderId }) {
  const boundary = 'ml' + crypto.randomBytes(12).toString('hex');
  const meta = JSON.stringify({ name, ...(folderId ? { parents: [folderId] } : {}) });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink',
    { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d;
}

// One place that answers "is Drive usable, and if not why" — the routes below all
// refuse rather than silently falling back, so nothing large lands in Supabase by
// accident and starts costing money later.
const RECONNECT = 'Google Drive was connected without upload permission — reconnect it: Google → My Drive → Connect.';

async function driveAdminToken() {
  if (!GOOGLE_CLIENT_ID) { const e = new Error('Google is not configured on this deployment.'); e.status = 409; throw e; }
  if (!ctx.driveTokens)      { const e = new Error('Connect Google Drive first — Google → My Drive → Connect.'); e.status = 409; throw e; }
  // Checked before the request, not after: a token from before the upload scope was
  // added refreshes fine and then fails at Drive with "Insufficient Permission",
  // which reads like a Google outage rather than one click of reconnecting.
  if (!ctx.driveCanUpload(ctx.driveTokens)) { const e = new Error(RECONNECT); e.status = 409; throw e; }
  try {
    return await getDriveToken(ctx.driveTokens, 'admin_drive');
  } catch (_) {
    const e = new Error('Google Drive needs reconnecting — Google → My Drive → Connect.');
    e.status = 409; throw e;
  }
}

// Drive says 403 "Insufficient Permission" both for a stale grant and for writing
// into a folder we do not own. Either way the cure is the same click, so say so.
function driveErrStatus(e) {
  return /insufficient permission|insufficientpermissions|forbidden/i.test(e.message || '') ? 409 : (e.status || 500);
}
function driveErrMessage(e) {
  return driveErrStatus(e) === 409 && !e.status ? RECONNECT : e.message;
}

// 25 MB: client paperwork is scans, and the shared `upload` is capped at 5 MB.
// The whole file sits in memory because Drive's multipart body needs one buffer, so
// the cap is really a memory bound — two concurrent uploads at 100 MB was 200 MB
// resident on a 512 MB instance, which presents as a mystery restart rather than an
// error. Genuinely large files need Drive's resumable endpoint (see README).
const DRIVE_MAX_MB = 25;
const driveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: DRIVE_MAX_MB * 1024 * 1024 } });

// Callers branch on the return value, so every failure path must return null.
// Returning res.status(...).json(...) here handed back a truthy response object that
// the caller then wrote into the database — a circular structure, not a file.
async function handleDriveUpload(req, res, folder) {
  if (!req.file) { res.status(400).json({ error: 'No file' }); return null; }
  try {
    const token = await driveAdminToken();
    const folderId = await driveEnsureFolder(token, folder);
    const f = await driveUploadFile(token, {
      buffer: req.file.buffer,
      name: req.file.originalname || 'file',
      mimeType: req.file.mimetype,
      folderId,
    });
    return { fileId: f.id, name: f.name, size: Number(f.size) || req.file.size || 0,
             mimeType: f.mimeType || req.file.mimetype || '', webViewLink: f.webViewLink };
  } catch (e) {
    res.status(driveErrStatus(e)).json({ error: driveErrMessage(e) });
    return null;
  }
}

// Multer rejects an oversized file by throwing; without this the request hangs.
function driveUploadGuard(err, _req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `That file is over the ${DRIVE_MAX_MB} MB limit.` });
  if (err) return res.status(400).json({ error: err.message });
  next();
}

// Attach a client file to a sale — mounted for both portals; writing to a sale
// is the deals.salesEdit action either way.
function mountSaleFileRoute(base, guard) {
  receiver.router.post(`${base}/:id/file`, guard, requirePerm('deals', 'salesEdit'),
  driveUpload.single('file'), driveUploadGuard, async (req, res) => {
    const meta = await handleDriveUpload(req, res, 'Client Files');
    if (!meta) return;
    const { data, error } = await supabase.from('sales')
      .update({ client_file: meta.webViewLink, client_file_meta: meta, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });
}
mountSaleFileRoute('/api/dashboard/sales', requireAuth);
mountSaleFileRoute('/api/employee/sales', requireEmployeeAuth);

// Supplier catalogue, documents and purchase history  → src/routes/supplier-catalogue.js
Object.assign(ctx, { driveUpload, driveUploadGuard, express, handleDriveUpload, receiver, requireAuth, supabase });
require('./supplier-catalogue');
mountSupplierRoutes('/api/dashboard/suppliers', requireAuth);
mountSupplierRoutes('/api/employee/suppliers', requireEmployeeAuth);

module.exports = {};
