// The workspace's name and picture. src/ctx.js explains the context object.
//
// Both portals called themselves "MotoLinker" in markup, and the round mark in the
// corner was a stylesheet background — so changing either meant a deploy. They are a
// setting now: the admin edits them, and every page reads them at load and is told
// the moment they change. Stored in the quotation_settings key/value table the rest
// of the org-wide settings live in, so this needs no migration.
//
// Reading is public on purpose: the sign-in pages show the workspace's name and
// picture before anyone has signed in, the way a chat workspace's own sign-in page
// does. Nothing else is in the record.
const ctx = require('../ctx');
const { crypto, express, multer, receiver, requireAuth, supabase } = ctx.need('crypto', 'express', 'multer', 'receiver', 'requireAuth', 'supabase');

const WORKSPACE_KEY = 'workspace_profile';
const WORKSPACE_DEFAULT_NAME = 'MotoLinker';
const WORKSPACE_NAME_MAX = 60;
// Read through a short cache: every page load asks, and it changes once in a blue moon.
const WORKSPACE_TTL_MS = 60_000;
let cached = null;   // { profile, at }

function workspaceShape(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const name = String(v.name || '').trim();
  return {
    name: name || WORKSPACE_DEFAULT_NAME,
    logo_url: typeof v.logo_url === 'string' ? v.logo_url : '',
    updated_at: v.updated_at || null,
    custom_name: !!name,
  };
}

async function workspaceProfile({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < WORKSPACE_TTL_MS) return cached.profile;
  let raw = null;
  try {
    const { data, error } = await supabase.from('quotation_settings').select('value').eq('key', WORKSPACE_KEY).maybeSingle();
    if (error) throw error;
    if (data && data.value) raw = JSON.parse(data.value);
  } catch (e) {
    // A database that can't answer still gets a named workspace: the default, not an error page.
    console.warn('[workspace] could not read the workspace profile:', e.message);
    if (cached) return cached.profile;
    return workspaceShape(null);
  }
  const profile = workspaceShape(raw);
  cached = { profile, at: Date.now() };
  return profile;
}

async function workspaceSave(patch) {
  const current = await workspaceProfile({ fresh: true });
  const next = {
    name: current.custom_name ? current.name : '',
    logo_url: current.logo_url,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: WORKSPACE_KEY, value: JSON.stringify(next), updated_at: next.updated_at }, { onConflict: 'key' });
  if (error) throw error;
  const profile = workspaceShape(next);
  cached = { profile, at: Date.now() };
  workspaceAnnounce(profile);
  return profile;
}

// Every open page — every tab of every person, on every page of either portal — is
// told at once, over the notification stream each of them keeps open from login on.
function workspaceAnnounce(profile) {
  const chunk = `event: workspace\ndata: ${JSON.stringify(profile)}\n\n`;
  for (const key of ctx.notifSseClients.keys()) ctx.notifWrite(key, chunk);
}

// A workspace name is a label, not a paragraph: one line, no control characters.
function workspaceCleanName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Raster images only — an SVG can carry script and would run it when opened on its own.
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const logoMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('file');
function logoUpload(req, res, next) {
  logoMulter(req, res, err => {
    if (!err) return next();
    const big = err.code === 'LIMIT_FILE_SIZE';
    res.status(big ? 413 : 400).json({ error: big ? 'The picture must be under 5 MB.' : 'Could not read that upload.' });
  });
}
// The picture nobody is shown any more goes from storage too (best effort).
function forgetLogo(url) {
  const m = /\/storage\/v1\/object\/public\/chat-files\/(workspace\/[^?#]+)$/.exec(String(url || ''));
  if (!m) return;
  supabase.storage.from('chat-files').remove([decodeURIComponent(m[1])])
    .then(({ error }) => { if (error) console.warn('[workspace] could not delete the old picture:', error.message); })
    .catch(() => {});
}

receiver.router.get('/api/workspace', async (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await workspaceProfile());
});

receiver.router.put('/api/dashboard/workspace', requireAuth, express.json(), async (req, res) => {
  const name = workspaceCleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Give the workspace a name.' });
  if ([...name].length > WORKSPACE_NAME_MAX) return res.status(400).json({ error: `Keep the name to ${WORKSPACE_NAME_MAX} characters.` });
  try { res.json(await workspaceSave({ name })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/workspace/logo', requireAuth, logoUpload, async (req, res) => {
  const ext = req.file && LOGO_TYPES[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: 'Choose a PNG, JPEG, WebP or GIF picture.' });
  const before = (await workspaceProfile({ fresh: true })).logo_url;
  const file = `workspace/logo_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const up = await supabase.storage.from('chat-files').upload(file, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (up.error) return res.status(500).json({ error: up.error.message });
  const logo_url = supabase.storage.from('chat-files').getPublicUrl(up.data.path).data.publicUrl;
  try {
    const profile = await workspaceSave({ logo_url });
    if (before && before !== logo_url) forgetLogo(before);
    res.json(profile);
  } catch (e) {
    forgetLogo(logo_url);
    res.status(500).json({ error: e.message });
  }
});

receiver.router.delete('/api/dashboard/workspace/logo', requireAuth, async (_req, res) => {
  const before = (await workspaceProfile({ fresh: true })).logo_url;
  try {
    const profile = await workspaceSave({ logo_url: '' });
    if (before) forgetLogo(before);
    res.json(profile);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { workspaceProfile };
