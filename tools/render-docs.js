#!/usr/bin/env node
// Render the sample documents to PDF / XLSX and PNG, to look at them.
//
//   node tools/render-docs.js                      every sample
//   node tools/render-docs.js quotation po         just these
//   node tools/render-docs.js --list               what samples exist
//   node tools/render-docs.js po --out /tmp/docs   choose the folder (default .doc-samples/)
//   node tools/render-docs.js po --dpi 110         PNG resolution (default 80)
//   node tools/render-docs.js po --html            also keep the HTML a PDF was printed from
//   node tools/render-docs.js po --no-png          skip the PNGs
//
// PDFs go through the same builders and the same renderer the app uses. The RFQ is an
// Excel workbook; its PNGs come from LibreOffice (`soffice`) when it is installed.
// PNGs need `pdftoppm` (poppler). Sample data lives in tools/doc-fixtures/.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const names = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--dpi'].includes(args[i - 1])));

// Which builder turns which fixture file into a document.
const KINDS = {
  quotation: { file: 'quotation', build: d => require('../src/lib/docs/quotation').buildQuotationHtml(d), ext: 'pdf' },
  po:        { file: 'po',        build: d => require('../src/lib/docs/purchase-order').buildPurchaseOrderHtml(d), ext: 'pdf' },
  contract:  { file: 'contract',  build: d => require('../src/lib/docs/contract').buildContractHtml(d), ext: 'pdf' },
  rfq:       { file: 'rfq',       build: d => require('../src/lib/docs/rfq-xlsx').buildRfqXlsx(d), ext: 'xlsx' },
};
const samples = {};
for (const [kind, spec] of Object.entries(KINDS)) {
  const fx = require(`./doc-fixtures/${spec.file}`);
  for (const [name, data] of Object.entries(fx)) samples[name] = { kind, spec, data };
}

if (flag('list')) {
  for (const [name, s] of Object.entries(samples)) console.log(`${name.padEnd(22)} ${s.spec.ext}`);
  process.exit(0);
}

// Use puppeteer's own Chrome when it has one; otherwise a Playwright-installed one.
function pointAtChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return;
  // Decided before puppeteer is required: it reads its configuration once, at load.
  const cache = process.env.PUPPETEER_CACHE_DIR || path.join(require('os').homedir(), '.cache', 'puppeteer');
  if (fs.existsSync(path.join(cache, 'chrome'))) return;
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return;
  for (const d of fs.readdirSync(root).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) { process.env.PUPPETEER_EXECUTABLE_PATH = exe; return; }
  }
}

const have = cmd => spawnSync('which', [cmd]).status === 0;
const run = (cmd, a, o) => spawnSync(cmd, a, { encoding: 'utf8', ...(o || {}) });

(async () => {
  pointAtChrome();
  const { renderPdf } = require('../src/lib/docs/render');
  const out = path.resolve(opt('out', path.join(ROOT, '.doc-samples')));
  fs.mkdirSync(out, { recursive: true });
  const dpi = opt('dpi', '80');
  const wanted = names.length ? names : Object.keys(samples);
  const unknown = wanted.filter(n => !samples[n]);
  if (unknown.length) { console.error(`unknown sample(s): ${unknown.join(', ')}  (try --list)`); process.exit(2); }

  for (const name of wanted) {
    const { spec, data } = samples[name];
    const t0 = Date.now();
    let pdfPath = path.join(out, `${name}.pdf`);
    try {
      if (spec.ext === 'pdf') {
        const html = spec.build(data);
        if (flag('html')) fs.writeFileSync(path.join(out, `${name}.html`), html);
        fs.writeFileSync(pdfPath, await renderPdf(html));
      } else {
        const xlsxPath = path.join(out, `${name}.xlsx`);
        fs.writeFileSync(xlsxPath, await spec.build(data));
        pdfPath = null;
        if (!flag('no-png') && have('soffice')) {
          // A private profile dir keeps LibreOffice from clashing with a running instance.
          const r = run('soffice', ['--headless', `-env:UserInstallation=file://${out}/.lo-profile`, '--convert-to', 'pdf', '--outdir', out, xlsxPath]);
          if (r.status === 0 && fs.existsSync(path.join(out, `${name}.pdf`))) pdfPath = path.join(out, `${name}.pdf`);
        }
      }
      let pages = '';
      if (pdfPath && !flag('no-png') && have('pdftoppm')) {
        for (const f of fs.readdirSync(out)) if (f.startsWith(`${name}-`) && f.endsWith('.png')) fs.unlinkSync(path.join(out, f));
        run('pdftoppm', ['-r', dpi, '-png', pdfPath, path.join(out, name)]);
        pages = `  ${fs.readdirSync(out).filter(f => f.startsWith(`${name}-`) && f.endsWith('.png')).length} page png(s)`;
      }
      console.log(`${name.padEnd(22)} ${spec.ext}  ${((Date.now() - t0) / 1000).toFixed(1)}s${pages}  → ${out}`);
    } catch (e) {
      console.error(`${name.padEnd(22)} FAILED: ${e.stack || e.message}`);
      process.exitCode = 1;
    }
  }
})();
