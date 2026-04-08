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

const COL_LABEL_MIN = 100;
const COL_LABEL_MAX = 215;
const COL_SIDEBAR_X = 100;
const FOOTER_MAX_Y  = 25;
const HEADER_MIN_Y  = 730;

// ── Auto-detect data column X centres ────────────────────────────────────────
function detectDataColumns(allItems) {
  const xCounts = {};
  for (const it of allItems) {
    if (it.x <= COL_LABEL_MAX || it.x > 610) continue;
    const b = Math.round(it.x / 3) * 3;
    xCounts[b] = (xCounts[b] || 0) + 1;
  }
  const maxC  = Math.max(1, ...Object.values(xCounts));
  const floor = Math.max(3, maxC * 0.08);
  const xs    = Object.entries(xCounts)
    .filter(([, c]) => c >= floor)
    .map(([x]) => parseInt(x))
    .sort((a, b) => a - b);
  const clusters = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.sum / last.n < 22) { last.sum += x; last.n++; }
    else clusters.push({ sum: x, n: 1 });
  }
  const centres = clusters.map(c => Math.round(c.sum / c.n));
  return centres.length ? centres : [224, 319, 414, 509];
}

function clusterRows(items, tolerance = 12) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const clusters = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(item.y - last.y) <= tolerance) {
      last.items.push(item);
      last.y = (last.y + item.y) / 2;
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

let specs = [];
let currentSection = '';

// Pass 1: collect all items
const allPageItems = [];
for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
  const page = await doc.getPage(pageNum);
  const tc   = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const x = Math.round(it.transform[4]);
    const y = Math.round(it.transform[5]);
    if (y < FOOTER_MAX_Y || y > HEADER_MIN_Y) continue;
    items.push({ s: it.str.trim(), x, y, page: pageNum });
  }
  allPageItems.push(items);
}

// Detect columns dynamically (supports up to 10 trims)
const flatItems     = allPageItems.flat();
const COL_CENTERS   = detectDataColumns(flatItems);
const colCount      = Math.min(COL_CENTERS.length, 10);
const colSpacing    = colCount > 1
  ? Math.min(...COL_CENTERS.slice(1).map((c, i) => c - COL_CENTERS[i]))
  : 50;
const COL_HALF_WIDTH = Math.floor(colSpacing * 0.44);
console.log(`[scraper] Detected ${colCount} trim columns at x=[${COL_CENTERS.slice(0,colCount).join(',')}] ±${COL_HALF_WIDTH}`);

function classifyX(x) {
  if (x < COL_SIDEBAR_X) return -2;
  if (x >= COL_LABEL_MIN && x <= COL_LABEL_MAX) return -1;
  for (let i = 0; i < colCount; i++) {
    if (Math.abs(x - COL_CENTERS[i]) <= COL_HALF_WIDTH) return i;
  }
  return -2;
}

// Pass 2: trim names & prices from page 1
const page1     = allPageItems[0];
const nameItems = page1.filter(it => it.y >= 590 && it.y <= 622);
const nameByCol = Array.from({ length: colCount }, () => ({}));
for (const it of nameItems) {
  const col = classifyX(it.x);
  if (col < 0 || col >= colCount) continue;
  if (!nameByCol[col][it.y]) nameByCol[col][it.y] = [];
  nameByCol[col][it.y].push(it.s);
}
const trimNames = COL_CENTERS.slice(0, colCount).map((_, ci) => {
  const byY = nameByCol[ci];
  return Object.keys(byY).sort((a, b) => b - a).map(y => byY[y].join(' ')).join(' ').replace(/\s+/g, ' ').trim();
});

const trimPrices = Array(colCount).fill('');
const priceItems = page1.filter(it => it.y >= 500 && it.y <= 565);
for (const it of priceItems) {
  const col = classifyX(it.x);
  if (col < 0 || col >= colCount) continue;
  if (/^\d[\d,]+$/.test(it.s) && !trimPrices[col]) trimPrices[col] = it.s;
}

// Pass 3: spec rows
let pendingLabel = '';
for (let pi = 0; pi < allPageItems.length; pi++) {
  const items = allPageItems[pi];
  const zoneItems = items.filter(it => {
    if (pi === 0 && it.y >= 480) return false;
    return classifyX(it.x) !== -2;
  });
  const rows = clusterRows(zoneItems);

  for (const row of rows) {
    const labelParts = row.items.filter(it => classifyX(it.x) === -1).map(it => it.s);
    const valueCells = Array(colCount).fill('');
    let hasValues    = false;

    for (const it of row.items) {
      const col = classifyX(it.x);
      if (col >= 0 && col < colCount) {
        valueCells[col] += (valueCells[col] ? ' ' : '') + it.s;
        hasValues = true;
      }
    }

    const labelText = labelParts.join(' ').replace(/\s+/g, ' ').trim();

    if (!hasValues && labelText) {
      pendingLabel = pendingLabel ? pendingLabel + ' ' + labelText : labelText;
    } else if (hasValues) {
      const fullLabel = pendingLabel ? pendingLabel + (labelText ? ' ' + labelText : '') : labelText;
      pendingLabel = '';
      if (!fullLabel) continue;
      specs.push({ section: currentSection, label: fullLabel, values: valueCells });
    } else if (labelText && labelText.length < 60 && !/\d/.test(labelText)) {
      currentSection = labelText;
      pendingLabel   = '';
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
const activeCols = Array.from({ length: colCount }, (_, i) => i)
  .filter(ci => specs.some(s => s.values[ci] && s.values[ci] !== '-'));

const result = {
  scraped_at:  new Date().toISOString(),
  source:      pdfPath,
  series_name: trimNames[0] ? trimNames[0].replace(/\s+\d{4}.*/, '').trim() : 'Unknown',
  trims: activeCols.map(ci => ({
    name:  trimNames[ci]  || `Trim ${ci + 1}`,
    price: trimPrices[ci] || '',
  })),
  specs: specs.map(s => ({ ...s, values: activeCols.map(ci => s.values[ci] || '') })),
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
