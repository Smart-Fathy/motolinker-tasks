// Run once after placing public/01 _ Onyx.png:
//   node scripts/generate-icons.js
// Then commit the generated files in public/icons/

const puppeteer = require('puppeteer');
const path = require('path');
const fs   = require('fs');

const logoPath = path.join(__dirname, '..', 'public', '01 _ Onyx.png');
const outDir   = path.join(__dirname, '..', 'public', 'icons');

if (!fs.existsSync(logoPath)) {
  console.error(`Logo not found: ${logoPath}`);
  console.error('Please commit public/01 _ Onyx.png first.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const sizes = [
  { file: 'icon-192.png',          size: 192, maskable: false },
  { file: 'icon-512.png',          size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true  },
  { file: 'apple-touch-icon.png',  size: 180, maskable: false },
];

async function generate() {
  console.log('Launching browser…');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page    = await browser.newPage();
  const logoB64 = fs.readFileSync(logoPath).toString('base64');

  for (const { file, size, maskable } of sizes) {
    const pad     = maskable ? Math.round(size * 0.12) : Math.round(size * 0.06);
    const imgSize = size - pad * 2;
    const html = `<!DOCTYPE html><html><head><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        width:${size}px; height:${size}px; background:#0a0b10;
        display:flex; align-items:center; justify-content:center;
        border-radius:${maskable ? 0 : Math.round(size * 0.18)}px;
        overflow:hidden;
      }
      img { width:${imgSize}px; height:${imgSize}px; object-fit:contain; }
    </style></head><body>
      <img src="data:image/png;base64,${logoB64}">
    </body></html>`;

    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(outDir, file), type: 'png' });
    console.log(`  ✓ ${file} (${size}×${size}${maskable ? ' maskable' : ''})`);
  }

  await browser.close();
  console.log('\nAll icons generated in public/icons/');
  console.log('Commit them: git add public/icons && git commit -m "Add PWA icons"');
}

generate().catch(e => { console.error(e); process.exit(1); });
