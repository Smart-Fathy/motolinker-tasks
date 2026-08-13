// Drive upload helpers, lifted from index.js and run against a stubbed Google API.
const fs = require('fs'), crypto = require('crypto');
// The server is split across index.js and src/routes/*; find whichever file holds
// the code under test so these stay valid as things move.
function serverSrc(marker) {
  const fs = require('fs');
  const files = ['index.js', ...fs.readdirSync('src/routes').map(f => 'src/routes/' + f)];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (s.includes(marker)) return s;
  }
  throw new Error('marker not found in any server file: ' + marker);
}
const src = serverSrc('const DRIVE_ROOT_FOLDER =');
const from = src.indexOf('const DRIVE_ROOT_FOLDER =');
const to = src.indexOf('async function driveAdminToken()');
if (from < 0 || to < 0) throw new Error('could not slice the drive block');
const BLOCK = src.slice(from, to);
for (const f of ['driveFindOrCreateFolder', 'driveEnsureFolder', 'driveUploadFile'])
  if (!BLOCK.includes(f)) throw new Error('slice missing ' + f);

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

function sandbox(fetchImpl) {
  return new Function('fetch', 'crypto', BLOCK +
    '\nreturn { driveEnsureFolder, driveUploadFile, driveFindOrCreateFolder, _driveFolders };')(fetchImpl, crypto);
}

(async () => {
  // ── Folder: found once, then cached; created only when absent ──
  {
    const calls = [];
    let rootExists = true, subExists = false;
    const f = async (url, opts) => {
      calls.push({ url: String(url), method: (opts || {}).method || 'GET' });
      if (String(url).includes('/drive/v3/files?q=')) {
        const q = decodeURIComponent(String(url));
        if (q.includes("name='MotoLinker'") && rootExists) return { json: async () => ({ files: [{ id: 'ROOT' }] }) };
        if (q.includes("name='Client Files'") && subExists) return { json: async () => ({ files: [{ id: 'SUB' }] }) };
        return { json: async () => ({ files: [] }) };
      }
      subExists = true;
      return { json: async () => ({ id: 'SUB' }) };
    };
    const s = sandbox(f);
    const id1 = await s.driveEnsureFolder('tok', 'Client Files');
    const created = calls.filter(x => x.method === 'POST').length;
    const before = calls.length;
    const id2 = await s.driveEnsureFolder('tok', 'Client Files');
    c('a missing folder is created under MotoLinker', id1 === 'SUB' && created === 1, `id=${id1} posts=${created}`);
    c('the second call is served from cache, with no API traffic',
      id2 === 'SUB' && calls.length === before, `calls after=${calls.length - before}`);
  }

  // ── Upload: multipart shape and the returned metadata ──
  {
    let seen = null;
    const f = async (url, opts) => {
      seen = { url: String(url), headers: opts.headers, body: opts.body };
      return { json: async () => ({ id: 'FILE1', name: 'passport.pdf', size: '2048',
                                    mimeType: 'application/pdf', webViewLink: 'https://drive.google.com/file/FILE1' }) };
    };
    const s = sandbox(f);
    const out = await s.driveUploadFile('tok', {
      buffer: Buffer.from('hello-bytes'), name: 'passport.pdf',
      mimeType: 'application/pdf', folderId: 'SUB' });
    const ct = seen.headers['Content-Type'] || '';
    const body = seen.body.toString('latin1');
    const boundary = (ct.match(/boundary=(\S+)/) || [])[1];
    c('it posts to the multipart upload endpoint',
      /upload\/drive\/v3\/files\?uploadType=multipart/.test(seen.url), seen.url.slice(0, 70));
    c('the content type declares a boundary that the body actually uses',
      /^multipart\/related; boundary=/.test(ct) && boundary && body.startsWith('--' + boundary)
      && body.trimEnd().endsWith('--' + boundary + '--'), ct);
    c('the metadata part names the file and its parent folder',
      body.includes('"name":"passport.pdf"') && body.includes('"parents":["SUB"]'));
    c('the raw bytes are in the body', body.includes('hello-bytes'));
    c('it returns the link and id the caller stores',
      out.id === 'FILE1' && out.webViewLink.endsWith('FILE1'), JSON.stringify(out));
  }

  // ── Binary must survive byte-for-byte ──
  {
    const bytes = crypto.randomBytes(4096);
    let body = null;
    const s = sandbox(async (_u, o) => { body = o.body; return { json: async () => ({ id: 'x' }) }; });
    await s.driveUploadFile('tok', { buffer: bytes, name: 'a.bin', mimeType: 'application/octet-stream' });
    const i = body.indexOf(bytes);
    c('binary content is not corrupted by the multipart framing',
      i > 0 && body.slice(i, i + bytes.length).equals(bytes), 'offset=' + i);
  }

  // ── A Google error surfaces instead of being swallowed ──
  {
    const s = sandbox(async () => ({ json: async () => ({ error: { message: 'Insufficient permission' } }) }));
    let msg = '';
    try { await s.driveUploadFile('tok', { buffer: Buffer.from('x'), name: 'a', mimeType: 'text/plain' }); }
    catch (e) { msg = e.message; }
    c('a Drive API error is raised, not silently ignored', msg === 'Insufficient permission', msg);
  }

  // ── The size guard ──
  {
    // The guard names the cap in its message, so the constant has to come along with
    // it — and it is read out of the source rather than restated here, so the message
    // and the multer limit can never drift apart in a passing test.
    const cap = Number(src.match(/const DRIVE_MAX_MB = (\d+)/)[1]);
    const g = new Function('DRIVE_MAX_MB', 'return ' + src.slice(src.indexOf('function driveUploadGuard')).match(/^function driveUploadGuard[\s\S]*?\n}/)[0])(cap);
    let code = 0, payload = null;
    const res = { status(s) { code = s; return this; }, json(p) { payload = p; } };
    g({ code: 'LIMIT_FILE_SIZE' }, {}, res, () => {});
    c('an oversized file is refused with 413 and a readable reason',
      code === 413 && new RegExp(cap + ' MB').test(payload.error), JSON.stringify({ code, payload }));
    code = 0; let nexted = false;
    g(null, {}, res, () => { nexted = true; });
    c('a normal upload passes straight through', nexted && code === 0);
  }

  // 25 MB is a memory bound, not a Drive limit: the whole file is buffered for the
  // length of the request. Still well above the shared 5 MB upload.
  c('the cap is 25 MB, above the shared 5 MB limit and below a memory hazard',
    /const DRIVE_MAX_MB = 25;/.test(src)
    && /driveUpload = multer\(.*fileSize: DRIVE_MAX_MB \* 1024 \* 1024/.test(src),
    (src.match(/const driveUpload = multer\(.*/) || [''])[0]);

  // The no-file path returns null like every other failure path. It used to return
  // the response object, which the caller then wrote to the database as a client
  // file reference — a circular structure, and a 500 on top of an already-sent 400.
  {
    const fn = src.slice(src.indexOf('async function handleDriveUpload'))
      .match(/^async function handleDriveUpload[\s\S]*?\n}/)[0];
    const h = new Function('return ' + fn)();
    let code = 0;
    const res = { status(s) { code = s; return this; }, json() { return { sent: true }; } };
    const out = await h({ file: null }, res, 'Client Files');
    c('a request with no file answers 400 and returns null, not the response object',
      out === null && code === 400, JSON.stringify({ code, out: typeof out }));
  }

  // ── The scope, which is what actually broke client-file upload ────────────────
  // Drive was authorised read-only, so every upload 403'd at the folder-creation
  // step no matter how connected the Drive page claimed to be. Asserting the scope
  // string is the only place this is checkable without a live Google account, and
  // it is the one line that has to stay right.
  {
    const idx = serverSrc('const DRIVE_SCOPES =');
    const scopes = (idx.match(/const DRIVE_SCOPES = [`'"]([^`'"]*)[`'"]/) || [])[1] || idx.match(/const DRIVE_SCOPES = `([\s\S]*?)`/)[1];
    const resolved = scopes.replace('${DRIVE_UPLOAD_SCOPE}', 'https://www.googleapis.com/auth/drive.file');
    c('Drive is authorised with a scope that can actually write',
      /auth\/drive\.file|auth\/drive(?![.\w])/.test(resolved), resolved);
    c('…and still with the read scope the Drive and Sheets browsers need',
      /auth\/drive\.readonly/.test(resolved));

    const can = new Function('DRIVE_UPLOAD_SCOPE',
      idx.slice(idx.indexOf('function driveCanUpload')).match(/^function driveCanUpload[\s\S]*?\n}/)[0]
      + '; return driveCanUpload;')('https://www.googleapis.com/auth/drive.file');
    const RO = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email';
    c('a token minted under the old read-only grant is recognised as unable to upload',
      can({ scope: RO }) === false);
    c('a token carrying the upload scope is accepted', can({ scope: resolved }) === true);
    c('a full-drive grant is accepted too',
      can({ scope: 'https://www.googleapis.com/auth/drive' }) === true);
    c('a token from before scopes were recorded is not condemned on a guess',
      can({}) === true && can(null) === true);
  }

  // A stale grant must be reported as "reconnect", not as a Drive failure: the token
  // refreshes perfectly, so nothing else in the system looks wrong.
  {
    const sup = serverSrc('async function driveAdminToken()');
    const fn = sup.slice(sup.indexOf('const RECONNECT =')).match(/^const RECONNECT[\s\S]*?\n}\n/)[0];
    const mk = (canUpload) => new Function('ctx', 'GOOGLE_CLIENT_ID', 'getDriveToken',
      fn + '; return driveAdminToken;')(
      { driveTokens: { access_token: 'a', scope: 'x' }, driveCanUpload: () => canUpload },
      'cid', async () => 'TOKEN');
    let err = null;
    try { await mk(false)(); } catch (e) { err = e; }
    c('a stale grant is refused before Drive is called, with a 409 and one clear action',
      !!err && err.status === 409 && /reconnect/i.test(err.message), err && err.message);
    c('a healthy grant hands back the token', await mk(true)() === 'TOKEN');
  }

  // Drive's own 403 says "Insufficient Permission", which reads as an outage. The
  // cure is the same single click, so the upload handler must say so.
  {
    const sup = serverSrc('function driveErrStatus');
    const fns = sup.slice(sup.indexOf('const RECONNECT =')).match(/^const RECONNECT[\s\S]*?function driveErrMessage[\s\S]*?\n}/)[0];
    const m = new Function(fns + '; return { driveErrStatus, driveErrMessage, RECONNECT };')();
    const e = new Error('Insufficient Permission');
    c('a Drive 403 becomes a 409 the UI already offers a Connect link for',
      m.driveErrStatus(e) === 409, String(m.driveErrStatus(e)));
    c('…and its message names the fix rather than quoting Google',
      /reconnect/i.test(m.driveErrMessage(e)), m.driveErrMessage(e));
    const other = Object.assign(new Error('Rate limit exceeded'), {});
    c('an unrelated Drive error is left alone',
      m.driveErrStatus(other) === 500 && m.driveErrMessage(other) === 'Rate limit exceeded');
  }

  // With drive.file the app may only write to folders it created — but readonly lets
  // it *see* a "MotoLinker" folder the user made by hand. Uploading into that one
  // 403s, so the lookup has to pass over it.
  {
    const calls = [];
    const f = async (url, opts) => {
      calls.push({ url: String(url), method: (opts || {}).method || 'GET' });
      if (String(url).includes('/drive/v3/files?q=')) {
        return { json: async () => ({ files: [{ id: 'THEIRS', capabilities: { canAddChildren: false } }] }) };
      }
      return { json: async () => ({ id: 'OURS' }) };
    };
    const s = sandbox(f);
    const id = await s.driveFindOrCreateFolder('tok', 'MotoLinker', null);
    c('a folder the app cannot write to is passed over and its own is created',
      id === 'OURS' && calls.some(x => x.method === 'POST'), 'id=' + id);
    c('the lookup asks Drive whether it may add children at all',
      calls[0].url.includes('canAddChildren'), decodeURIComponent(calls[0].url).slice(-60));
  }

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
