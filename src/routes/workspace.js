// The workspace's name, picture and look. src/ctx.js explains the context object.
//
// Both portals called themselves "MotoLinker" in markup, and the round mark in the
// corner was a stylesheet background — so changing either meant a deploy. They are a
// setting now: the admin edits them, and every page reads them at load and is told
// the moment they change. Stored in the quotation_settings key/value table the rest
// of the org-wide settings live in, so this needs no migration.
//
// The look — colours, fonts, shape, the wording on the sign-in pages — lives in the
// same record, as data: a preset id, hex colours, ids from an allow-list, small
// integers, short plain text. public/assets/theme-core.js is the only thing that turns
// it into CSS (custom properties and nothing else), and it is run here on every read
// as well as every write, so a row that was edited by hand cannot put anything but a
// colour into a page.
//
// Reading is public on purpose: the sign-in pages show the workspace's name, picture
// and look before anyone has signed in, the way a chat workspace's own sign-in page
// does. Nothing else is in the record.
const ctx = require('../ctx');
const ThemeCore = require('../../public/assets/theme-core.js');
const { crypto, express, multer, receiver, requireAuth, supabase } = ctx.need('crypto', 'express', 'multer', 'receiver', 'requireAuth', 'supabase');

const WORKSPACE_KEY = 'workspace_profile';
const WORKSPACE_DEFAULT_NAME = 'MotoLinker';
const WORKSPACE_NAME_MAX = 60;
// Read through a short cache: every page load asks, and it changes once in a blue moon.
const WORKSPACE_TTL_MS = 60_000;
let cached = null;   // { profile, at }

// The picture is put into a stylesheet's url(), so only an address this app wrote is
// believed: our own storage bucket, our own folder, a plain file name.
const LOGO_URL = /^https?:\/\/[^\s"'()<>\\]+\/storage\/v1\/object\/public\/chat-files\/workspace\/[\w.-]+$/;
// The four sections of the look, each saved whole.
const LOOK_SECTIONS = ['theme', 'typography', 'shape', 'texts'];

function workspaceShape(raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = workspaceCleanName(v.name).slice(0, WORKSPACE_NAME_MAX);
  const look = ThemeCore.normalize(v);
  return {
    name: name || WORKSPACE_DEFAULT_NAME,
    logo_url: typeof v.logo_url === 'string' && LOGO_URL.test(v.logo_url) ? v.logo_url : '',
    updated_at: typeof v.updated_at === 'string' ? v.updated_at : null,
    custom_name: !!name,
    theme: look.theme, typography: look.typography, shape: look.shape, texts: look.texts,
  };
}

// The stored record as it is, or null if there is none. Throws if the database can't answer.
async function workspaceRaw() {
  const { data, error } = await supabase.from('quotation_settings').select('value').eq('key', WORKSPACE_KEY).maybeSingle();
  if (error) throw error;
  if (!data || !data.value) return null;
  try { const v = JSON.parse(data.value); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  catch (_) { return null; }   // a row that isn't JSON is no profile, not a reason to call the database down
}

// One read at a time, shared by everyone who asks while it is out. It never rejects: a
// read that fails resolves to null, and says so in the log.
let reading = null;
let saves = 0;   // bumped by every save, so a read that began before one cannot overwrite it
function loadProfile() {
  if (!reading) {
    const began = saves;
    reading = workspaceRaw()
      .then(raw => {
        const profile = workspaceShape(raw);
        if (saves === began) cached = { profile, at: Date.now() };
        return profile;
      })
      .catch(e => { console.warn('[workspace] could not read the workspace profile:', e.message); return null; })
      .finally(() => { reading = null; });
  }
  return reading;
}

// `patience` is for callers that must not stand waiting on the database — the pages
// themselves, which need no database to open. It is the longest they will wait: past
// that they get what was last known (however old), or the original marked degraded, and
// the read carries on in the background to fill the cache for the next visitor.
async function workspaceProfile({ fresh = false, patience = 0 } = {}) {
  if (!fresh && cached && Date.now() - cached.at < WORKSPACE_TTL_MS) return cached.profile;
  if (patience > 0 && !fresh && cached) { loadProfile(); return cached.profile; }   // stale beats slow
  const read = loadProfile();
  const got = patience > 0 ? await Promise.race([read, new Promise(r => setTimeout(() => r(null), patience).unref())]) : await read;
  if (got) return got;
  // A database that can't answer still gets a named workspace: the default, not an error page.
  if (cached) return cached.profile;
  // Said out loud, so nobody mistakes it for the real thing: a page that gets this has
  // not heard from the database, and must not forget the look it already has.
  return { ...workspaceShape(null), degraded: true };
}

// Changes are merged onto the record as stored, not rebuilt from what this module
// knows: a name change must not undo a colour change, and one made by a newer version
// of the app must survive a save from an older one.
async function workspaceSave(patch) {
  const raw = (await workspaceRaw()) || {};
  // Strictly later than whatever was there, so pages can tell which of two profiles is newer.
  const before = Date.parse(raw.updated_at);
  const at = new Date(Number.isFinite(before) && before >= Date.now() ? before + 1 : Date.now()).toISOString();
  const next = { ...raw, ...patch, updated_at: at };
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: WORKSPACE_KEY, value: JSON.stringify(next), updated_at: at }, { onConflict: 'key' });
  if (error) throw error;
  const profile = workspaceShape(next);
  saves++;
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

// The look. Each section sent replaces that section whole (so "no accent" is expressed by
// leaving it out); a section left out of the body is untouched. { reset: true } puts all four
// back to the original. Nothing is stored that theme-core would not draw: every field is
// checked, and a combination nobody could read is refused with the pair that fails.
receiver.router.put('/api/dashboard/workspace/theme', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const patch = {};
  if (body.reset === true) {
    for (const k of LOOK_SECTIONS) patch[k] = {};
  } else {
    const given = LOOK_SECTIONS.filter(k => k in body);
    if (!given.length) return res.status(400).json({ error: 'Send at least one of: ' + LOOK_SECTIONS.join(', ') + '.' });
    const { value, errors } = ThemeCore.validate(Object.fromEntries(given.map(k => [k, body[k] === null ? {} : body[k]])));
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    for (const k of given) patch[k] = value[k];
  }
  try {
    const stored = (await workspaceRaw()) || {};
    const problems = ThemeCore.problems({ ...stored, ...patch }).filter(p => p.level === 'error');
    if (problems.length) return res.status(400).json({ error: problems[0].message, problems });
    res.json(await workspaceSave(patch));
  } catch (e) { res.status(500).json({ error: e.message }); }
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

module.exports = { workspaceProfile, workspaceShape };
