// Suppliers (Logistics & Shipping)
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { GOOGLE_CLIENT_ID, crypto, express, getDriveToken, multer, receiver, requireAuth, supabase, upload } = ctx.need('GOOGLE_CLIENT_ID', 'crypto', 'express', 'getDriveToken', 'multer', 'receiver', 'requireAuth', 'supabase', 'upload');
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
  return { row: {
    name,
    contact: String(b.contact || '').trim(),
    address: String(b.address || '').trim(),
    country: String(b.country || '').trim(),
    notes:   String(b.notes || '').trim(),
  } };
}

receiver.router.get('/api/dashboard/suppliers', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('suppliers').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/suppliers', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = supplierBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('suppliers').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/suppliers/:id', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = supplierBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('suppliers').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/suppliers/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('suppliers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

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
  const look = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } });
  const found = await look.json();
  if (found.error) throw new Error(found.error.message);
  if (found.files && found.files.length) return found.files[0].id;

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
async function driveAdminToken() {
  if (!GOOGLE_CLIENT_ID) { const e = new Error('Google is not configured on this deployment.'); e.status = 409; throw e; }
  if (!ctx.driveTokens)      { const e = new Error('Connect Google Drive first — Google → My Drive → Connect.'); e.status = 409; throw e; }
  try {
    return await getDriveToken(ctx.driveTokens, 'admin_drive');
  } catch (_) {
    const e = new Error('Google Drive needs reconnecting — Google → My Drive → Connect.');
    e.status = 409; throw e;
  }
}

// 100 MB: client paperwork is scans, and the shared `upload` is capped at 5 MB.
// Memory storage is fine here because the multipart body needs the whole buffer.
const driveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

async function handleDriveUpload(req, res, folder) {
  if (!req.file) return res.status(400).json({ error: 'No file' });
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
    res.status(e.status || 500).json({ error: e.message });
    return null;
  }
}

// Multer rejects an oversized file by throwing; without this the request hangs.
function driveUploadGuard(err, _req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 100 MB limit.' });
  if (err) return res.status(400).json({ error: err.message });
  next();
}

// Attach a client file to a sale
receiver.router.post('/api/dashboard/sales/:id/file', requireAuth,
  driveUpload.single('file'), driveUploadGuard, async (req, res) => {
    const meta = await handleDriveUpload(req, res, 'Client Files');
    if (!meta) return;
    const { data, error } = await supabase.from('sales')
      .update({ client_file: meta.webViewLink, client_file_meta: meta, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

// Supplier catalogue, documents and purchase history  → src/routes/supplier-catalogue.js
Object.assign(ctx, { driveUpload, driveUploadGuard, express, handleDriveUpload, receiver, requireAuth, supabase });
require('./supplier-catalogue');

module.exports = {};
