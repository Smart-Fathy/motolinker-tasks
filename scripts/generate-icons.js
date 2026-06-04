// Run once after placing public/01 _ Onyx.png:
//   npm install sharp
//   node scripts/generate-icons.js
// Then commit the generated files in public/icons/
//
// The source image is app-icon artwork (gold monogram on a black rounded
// square) with a caption line beneath it. This script auto-detects the dark
// square's bounding box (ignoring the caption text and white margins), crops
// to it, and renders the required PWA icon sizes on a matching dark field.

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const logoPath = path.join(__dirname, '..', 'public', '01 _ Onyx.png');
const outDir   = path.join(__dirname, '..', 'public', 'icons');

if (!fs.existsSync(logoPath)) {
  console.error(`Logo not found: ${logoPath}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png',          size: 192, maskable: false },
  { file: 'icon-512.png',          size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true  },
  { file: 'apple-touch-icon.png',  size: 180, maskable: false },
];

async function run() {
  const { data, info } = await sharp(logoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;

  const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const DARK = 70;

  // Vertical extent of the big dark blob (rows with many dark px = the square).
  let top = -1, bottom = -1;
  const rowMin = W * 0.30;
  for (let y = 0; y < H; y++) {
    let count = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * channels;
      if (data[i + 3] > 200 && lum(i) < DARK) count++;
    }
    if (count > rowMin) {
      if (top === -1) top = y;
      bottom = y;
    } else if (top !== -1 && y - bottom > H * 0.04) {
      break; // gap after the square = caption begins
    }
  }

  // Horizontal extent within [top, bottom].
  let left = -1, right = -1;
  const colMin = (bottom - top) * 0.30;
  for (let x = 0; x < W; x++) {
    let count = 0;
    for (let y = top; y <= bottom; y++) {
      const i = (y * W + x) * channels;
      if (data[i + 3] > 200 && lum(i) < DARK) count++;
    }
    if (count > colMin) {
      if (left === -1) left = x;
      right = x;
    }
  }

  // Sample square fill color at top-center edge.
  const sx = Math.round((left + right) / 2), sy = top + 6;
  const si = (sy * W + sx) * channels;
  const bg = { r: data[si], g: data[si + 1], b: data[si + 2], alpha: 1 };

  const cropW = right - left, cropH = bottom - top;
  console.log('Detected square bbox:', { left, top, cropW, cropH, bg });

  for (const { file, size, maskable } of targets) {
    const inner = maskable ? Math.round(size * 0.80) : size;

    const square = await sharp(logoPath)
      .extract({ left, top, width: cropW, height: cropH })
      .resize(inner, inner, { fit: 'cover' })
      .png()
      .toBuffer();

    let out = sharp({
      create: { width: size, height: size, channels: 4, background: bg },
    }).composite([{ input: square, gravity: 'centre' }]);

    await out.png().toFile(path.join(outDir, file));
    console.log(`  ✓ ${file} (${size}×${size}${maskable ? ' maskable' : ''})`);
  }

  // Favicon
  await sharp(path.join(outDir, 'icon-192.png'))
    .resize(48, 48)
    .png()
    .toFile(path.join(outDir, 'favicon.png'));
  console.log('  ✓ favicon.png (48×48)');

  console.log('\nAll icons generated in public/icons/');
}

run().catch(e => { console.error(e); process.exit(1); });
