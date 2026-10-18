// The shared look of every generated document (src/lib/docs/brand.js): the palette from the
// logo, the embedded fonts and logos, the company block, and the page shell that repeats
// the header and footer on every page of a PDF of any length.
const fs = require('fs');
const path = require('path');

// Use the sandbox's Chrome when puppeteer has none of its own (read once, at load).
if (!process.env.PUPPETEER_EXECUTABLE_PATH && !fs.existsSync(path.join(process.env.HOME || '/root', '.cache', 'puppeteer', 'chrome'))) {
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (fs.existsSync(exe)) process.env.PUPPETEER_EXECUTABLE_PATH = exe;
}
const brand = require('../src/lib/docs/brand');
const { renderPdf } = require('../src/lib/docs/render');

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const isPng = buf => buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

(async () => {
  // ── Palette: straight from the logo ──
  check('the palette is the logo\'s: dark green #043627 and brand green #3A8E0E',
    brand.COLORS.ink === '#043627' && brand.COLORS.green === '#3A8E0E', JSON.stringify([brand.COLORS.ink, brand.COLORS.green]));

  // ── Company block ──
  const d = brand.company({});
  check('the company block falls back to the registered details',
    d.email === 'info@motolinkers.com' && d.taxId === '773934006' && d.regNo === '282378' && /Heliopolis/.test(d.address) && /AUTOMOTIVE/.test(d.tagline), JSON.stringify(d));
  const o = brand.company({ company_email: 'sales@example.com', company_phone: '  +20 1  ', company_tax_id: '', footer_note: 'Internal' });
  check('settings override a default, a blank setting does not',
    o.email === 'sales@example.com' && o.phone === '+20 1' && o.taxId === '773934006' && o.note === 'Internal', JSON.stringify(o));

  // ── Helpers ──
  check('esc turns markup into text', brand.esc(`<img src="x" onerror='a'> & b`) === '&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt; &amp; b');
  check('esc and escBr survive null and numbers', brand.esc(null) === '' && brand.esc(0) === '0' && brand.escBr('a\nb') === 'a<br>b');
  check('num prints thousands, keeps up to two decimals, and is blank for junk',
    brand.num(1915050) === '1,915,050' && brand.num('1,234.5') === '1,234.5' && brand.num(0.256) === '0.26' && brand.num('') === '' && brand.num('Free') === '');

  // ── Assets ship with the app and are embedded, not linked ──
  const logo = brand.logoBuffer('color');
  check('the logo is a 1200px-wide transparent PNG', isPng(logo) && pngSize(logo).w === 1200 && pngSize(logo).h === 227, JSON.stringify(pngSize(logo)));
  check('the white, reverse and mark variants exist',
    ['white', 'reverse'].every(v => isPng(brand.logoBuffer(v))) && ['color', 'white'].every(v => isPng(brand.markBuffer(v))));
  check('an unknown variant falls back to the colour logo', brand.logoBuffer('nope').equals(logo));
  check('logos come back as data URIs', /^data:image\/png;base64,/.test(brand.logoUri('reverse')) && /^data:image\/png;base64,/.test(brand.markUri()));
  const css = brand.fontCss();
  check('the fonts are embedded: Poppins 400–700 and Cairo for Arabic, as data URIs',
    [400, 500, 600, 700].every(w => new RegExp(`font-family:'Poppins';[^}]*font-weight:${w};`).test(css))
    && /font-family:'Cairo';[^}]*unicode-range:U\+0600-06FF/.test(css) && !/url\((?!data:)/.test(css), `${(css.length / 1024) | 0} KB`);
  check('the font CSS is built once', brand.fontCss() === css);

  // ── The shell ──
  const html = brand.shell({ title: 'A <b>title</b>', settings: { company_email: 'x@y.z' }, header: { ref: { label: 'QUOTATION', id: 'MT1' } }, footer: { note: 'Valid until X' }, body: '<p id="b">body</p>' });
  check('the shell has a fixed header and footer around a flowing body',
    /class="doc-header"/.test(html) && /class="doc-footer"/.test(html) && /<table class="flow">/.test(html) && /<tfoot>/.test(html) && /id="b"/.test(html));
  check('the title is escaped, the reference and the note are printed',
    /<title>A &lt;b&gt;title&lt;\/b&gt;<\/title>/.test(html) && /QUOTATION/.test(html) && /MT1/.test(html) && /Valid until X/.test(html) && /x@y\.z/.test(html));
  check('the page carries a "Page n of N" counter', /counter\(page\)/.test(html) && /counter\(pages\)/.test(html));
  const ar = brand.shell({ dir: 'rtl', body: '' });
  check('an Arabic shell is right-to-left, in Arabic, with an Arabic page counter',
    /<html lang="ar" dir="rtl">/.test(ar) && /صفحة/.test(ar) && /@bottom-left/.test(ar));
  check('no external fetch: nothing but data: URIs in the document', !/(src|href)=["']https?:/.test(html) && !/url\(["']?https?:/.test(html));

  // ── Rendering: a long document gets the furniture on every page ──
  const blocks = Array.from({ length: 40 }, (_, i) => `<div class="card" style="margin-bottom:3mm"><h4>Block ${i + 1}</h4><p>${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(6)}</p></div>`).join('');
  const pdf = Buffer.from(await renderPdf(brand.shell({ title: 'Long', body: blocks, footer: { note: 'FOOTNOTE' } })));
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('a long document paginates (several A4 pages)', pages >= 3, `${pages} pages`);
  check('the PDF starts as a PDF and embeds Poppins', pdf.slice(0, 5).toString() === '%PDF-' && /Poppins/.test(pdf.toString('latin1')));
  check('the page size is A4', /\/MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*\s*\]/.test(pdf.toString('latin1')));

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
