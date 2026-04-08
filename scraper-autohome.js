#!/usr/bin/env node
/**
 * Autohome.com.cn config/series PDF scraper
 * Usage:  node scraper-autohome.js [path/to/file.pdf] [--out output.json]
 * Default input: "Avatr 06.pdf" (fetched from git main branch)
 */

import * as pdfjsLib from './node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outFile = outFlag !== -1 ? args[outFlag + 1] : path.join(__dirname, 'autohome-output.json');
const pdfArg  = args.find(a => !a.startsWith('--') && (outFlag === -1 || args[outFlag + 1] !== a));

// ── Resolve PDF ───────────────────────────────────────────────────────────────
let pdfPath = pdfArg || path.join(__dirname, 'Avatr 06.pdf');

if (!existsSync(pdfPath)) {
  // Try to fetch from git main branch
  const tmpPath = '/tmp/avatr06.pdf';
  try {
    execSync(`git show origin/main:"Avatr 06.pdf" > "${tmpPath}"`, { cwd: __dirname });
    pdfPath = tmpPath;
    console.log('[scraper] PDF loaded from git main branch');
  } catch (_) {
    console.error(`[scraper] PDF not found at: ${pdfPath}`);
    process.exit(1);
  }
}

// ── Column layout (x-centre of each trim column) ─────────────────────────────
// Detected from PDF: labels≈130, col1≈224, col2≈319, col3≈414, col4≈509
const COL_LABEL_MIN  = 100;
const COL_LABEL_MAX  = 220;
const COL_SIDEBAR_X  = 100;   // x < this = left sidebar nav (skip)
const COL_CENTERS    = [224, 319, 414, 509];
const COL_HALF_WIDTH = 55;    // ±55px tolerance per column

// Footer/header Y ranges to exclude (per page, y<25 or y>730)
const FOOTER_MAX_Y = 25;
const HEADER_MIN_Y = 730;

// ── Helper: which column does an x value belong to (-1 = label, -2 = skip) ───
function classifyX(x) {
  if (x < COL_SIDEBAR_X)               return -2;  // left sidebar
  if (x >= COL_LABEL_MIN && x <= COL_LABEL_MAX) return -1; // spec label
  for (let i = 0; i < COL_CENTERS.length; i++) {
    if (Math.abs(x - COL_CENTERS[i]) <= COL_HALF_WIDTH) return i;
  }
  return -2; // unknown / UI chrome
}

// ── Cluster items into rows by shared Y band ─────────────────────────────────
function clusterRows(items, tolerance = 12) {
  const sorted = [...items].sort((a, b) => b.y - a.y); // top of page first
  const clusters = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(item.y - last.y) <= tolerance) {
      last.items.push(item);
      last.y = (last.y + item.y) / 2; // running average
    } else {
      clusters.push({ y: item.y, items: [item] });
    }
  }
  return clusters;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`[scraper] Parsing: ${pdfPath}`);
const buf = readFileSync(pdfPath);
const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
console.log(`[scraper] Pages: ${doc.numPages}`);

let trimNames  = [];   // ['Avita 06 2025 Pro …', …]
let trimPrices = [];   // ['209,900', …]
let specs      = [];   // [{ section, label, values: ['val1','val2',…] }, …]
let currentSection = '';

// ── Pass 1: collect all items across all pages ─────────────────────────────
const allPageItems = [];

for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
  const page   = await doc.getPage(pageNum);
  const tc     = await page.getTextContent();
  const items  = [];

  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const x = Math.round(it.transform[4]);
    const y = Math.round(it.transform[5]);
    // Skip header/footer bands
    if (y < FOOTER_MAX_Y || y > HEADER_MIN_Y) continue;
    items.push({ s: it.str.trim(), x, y, page: pageNum });
  }
  allPageItems.push(items);
}

// ── Pass 2: extract trim names & prices from page 1 ──────────────────────────
const page1 = allPageItems[0];

// Trim names sit at y=596–620 (multi-line per column); y=634 is a UI pin element
const nameItems = page1.filter(it => it.y >= 590 && it.y <= 622);
const nameByCol = [{}, {}, {}, {}];
for (const it of nameItems) {
  const col = classifyX(it.x);
  if (col < 0) continue;
  if (!nameByCol[col][it.y]) nameByCol[col][it.y] = [];
  nameByCol[col][it.y].push(it.s);
}

trimNames = COL_CENTERS.map((_, ci) => {
  const byY = nameByCol[ci];
  return Object.keys(byY)
    .sort((a, b) => b - a)
    .map(y => byY[y].join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
});

// Prices sit at y≈541–560 on page 1
const priceItems = page1.filter(it => it.y >= 500 && it.y <= 565);
trimPrices = COL_CENTERS.map(() => '');
for (const it of priceItems) {
  const col = classifyX(it.x);
  if (col < 0) continue;
  // Match number-like price strings
  if (/^\d[\d,]+$/.test(it.s) && !trimPrices[col]) {
    trimPrices[col] = it.s;
  }
}

// ── Pass 3: extract spec rows page by page ────────────────────────────────────
// We accumulate multi-line label text across consecutive rows until a value row appears.
let pendingLabel = '';
let pendingLabelY = null;

for (let pi = 0; pi < allPageItems.length; pi++) {
  const items = allPageItems[pi];

  // Filter to spec-table zone: skip prices/trim-name header area on page 1
  const zoneItems = items.filter(it => {
    if (pi === 0 && it.y >= 480) return false; // skip header section on page 1
    const col = classifyX(it.x);
    return col !== -2;
  });

  const rows = clusterRows(zoneItems);

  // Process rows top to bottom (already sorted by descending y = top first)
  for (const row of rows) {
    const labelParts  = row.items.filter(it => classifyX(it.x) === -1).map(it => it.s);
    const valueCells  = ['', '', '', ''];
    let   hasValues   = false;

    for (const it of row.items) {
      const col = classifyX(it.x);
      if (col >= 0 && col < 4) {
        valueCells[col] += (valueCells[col] ? ' ' : '') + it.s;
        hasValues = true;
      }
    }

    const labelText = labelParts.join(' ').replace(/\s+/g, ' ').trim();

    if (!hasValues && labelText) {
      // Accumulate multi-line label
      pendingLabel = pendingLabel ? pendingLabel + ' ' + labelText : labelText;
      pendingLabelY = row.y;
    } else if (hasValues) {
      const fullLabel = pendingLabel
        ? pendingLabel + (labelText ? ' ' + labelText : '')
        : labelText;
      pendingLabel = '';

      if (!fullLabel) continue;

      specs.push({
        section: currentSection,
        label:   fullLabel,
        values:  valueCells,
      });
    } else if (labelText) {
      // Section-like row with no values and not accumulating — might be a section header
      // (These tend to be short, in title case, without numbers)
      if (labelText.length < 60 && !/\d/.test(labelText)) {
        currentSection = labelText;
        pendingLabel   = '';
      }
    }
  }
}

// ── Post-processing cleanup ───────────────────────────────────────────────────
// Known section-header strings that bleed into labels (they come from left sidebar
// items whose x falls just inside the label band on some pages)
const SECTION_PREFIXES = [
  'Basic parameters','Body','engine','electric motor','Battery/Charging','gearbox',
  'Chassis Steering','Wheel Braking','passive safety','Active safety',
  'Driving control','Driving hardware','Driving functions',
  'Appearance/Anti-theft','exterior lights','Skylight/Glass',
  'exterior rearview mirror','Interconnected/Internet of Vehicles',
  'Steering wheel/rearview mirror','In-car charging','Seating configuration',
  'Audio/Interior Lighting','Air conditioner/refrigerator','Special features',
  'color','Optional Package','Standard configuration','Standard safety configuration',
  'Standard control configuration','Standard hardware configuration',
  'Standard functions configuration','Standard theft configuration',
  'Standard lights configuration','Standard wheel/rearview','Standard charging configuration',
  'Standard Package',
];
const SECTION_RE = new RegExp('^(' + SECTION_PREFIXES.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*', 'i');

// Footer/site boilerplate strings to strip from values
const FOOTER_NOISE = [
  'about Us','Contact Us','Recruiting talents','© 2004','www.autohome.com.cn',
  'Business License','All Rights Reserved','Autohome owns all rights',
  'App client','Mobile web version','Autohome','Feedback',
];
const FOOTER_RE = new RegExp('(' + FOOTER_NOISE.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ').*$', 'i');

specs = specs
  .filter(s => s.label && s.values.some(v => v && v !== '-'))
  .map(s => ({
    ...s,
    label:  s.label.replace(SECTION_RE, '').replace(FOOTER_RE, '').trim(),
    values: s.values.map(v => v.replace(FOOTER_RE, '').trim()),
  }))
  .filter(s => s.label);

// ── Build output ──────────────────────────────────────────────────────────────
const result = {
  scraped_at:  new Date().toISOString(),
  source:      pdfPath,
  series_name: 'Avita 06',
  trims: COL_CENTERS.map((_, i) => ({
    name:  trimNames[i]  || `Trim ${i + 1}`,
    price: trimPrices[i] || '',
  })),
  specs,
};

// ── Console summary ──────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────');
console.log(`Series: ${result.series_name}`);
console.log(`Trims (${result.trims.length}):`);
result.trims.forEach((t, i) =>
  console.log(`  [${i + 1}] ${t.name}  →  ¥${t.price || '?'}`)
);
console.log(`Spec rows: ${result.specs.length}`);
console.log('\nSample specs:');
result.specs.slice(0, 8).forEach(s =>
  console.log(`  ${s.label}: ${s.values.slice(0, 3).join(' | ')}`)
);
console.log('─────────────────────────────────────────────');

writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
console.log(`\n[scraper] Saved → ${outFile}`);
