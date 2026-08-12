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
    const g = new Function('return ' + src.slice(src.indexOf('function driveUploadGuard')).match(/^function driveUploadGuard[\s\S]*?\n}/)[0])();
    let code = 0, payload = null;
    const res = { status(s) { code = s; return this; }, json(p) { payload = p; } };
    g({ code: 'LIMIT_FILE_SIZE' }, {}, res, () => {});
    c('an oversized file is refused with 413 and a readable reason',
      code === 413 && /100 MB/.test(payload.error), JSON.stringify({ code, payload }));
    code = 0; let nexted = false;
    g(null, {}, res, () => { nexted = true; });
    c('a normal upload passes straight through', nexted && code === 0);
  }

  c('the cap is 100 MB, not the shared 5 MB limit',
    /driveUpload = multer\(.*fileSize: 100 \* 1024 \* 1024/.test(src),
    (src.match(/const driveUpload = multer\(.*/) || [''])[0]);

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
