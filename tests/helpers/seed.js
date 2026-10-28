// Rows for every table the app reads, made from schema.sql and the migrations: every column
// gets a value of its type, and a column with CHECK (x IN (...)) cycles through the allowed
// words so each status, priority and stage gets drawn. For tests and tools that need the
// screens full of something (tools/theme-golden.js, tests/themeaudit.js).
const fs = require('fs');
const path = require('path');

function parseSchema() {
  const files = [path.join(__dirname, '..', '..', 'schema.sql'), ...fs.readdirSync(path.join(__dirname, '..', '..', 'migrations')).sort().map(f => path.join(__dirname, '..', '..', 'migrations', f))];
  const tables = {};
  const splitTop = body => { const out = []; let d = 0, cur = ''; for (const ch of body) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; };
  const colOf = text => {
    const m = text.trim().match(/^"?(\w+)"?\s+([A-Za-z_]+(?:\s*\([^)]*\))?(?:\[\])?)([\s\S]*)$/);
    if (!m || /^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK)$/i.test(m[1])) return null;
    const rest = m[3];
    const enums = [];
    for (const c of rest.matchAll(/CHECK\s*\(\s*"?\w+"?\s+IN\s*\(([^)]*)\)/gi)) for (const w of c[1].matchAll(/'([^']*)'/g)) enums.push(w[1]);
    const def = (rest.match(/DEFAULT\s+(.+?)(?:\s+(?:NOT|NULL|CHECK|REFERENCES|PRIMARY|UNIQUE)\b|$)/is) || [])[1] || '';
    return { name: m[1], type: m[2].toLowerCase(), enums, def: def.trim() };
  };
  for (const f of files) {
    const sql = fs.readFileSync(f, 'utf8').replace(/--.*$/gm, '');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
      const t = tables[m[1]] = tables[m[1]] || { cols: [] };
      for (const item of splitTop(m[2])) {
        const c = colOf(item); if (!c) continue;
        if (!t.cols.some(x => x.name === c.name)) t.cols.push(c);
        else if (c.enums.length) t.cols.find(x => x.name === c.name).enums = c.enums;
        for (const k of item.matchAll(/CHECK\s*\(\s*"?(\w+)"?\s+IN\s*\(([^)]*)\)/gi)) {
          const col = t.cols.find(x => x.name === k[1]); if (col && !col.enums.length) col.enums = [...k[2].matchAll(/'([^']*)'/g)].map(w => w[1]);
        }
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE(?: IF EXISTS)?\s+(?:public\.)?(\w+)\s+([\s\S]*?);/gi)) {
      const t = tables[m[1]]; if (!t) continue;
      for (const a of m[2].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+([\s\S]*?)(?=,\s*ADD COLUMN|$)/gi)) {
        const c = colOf(a[1]); if (c && !t.cols.some(x => x.name === c.name)) t.cols.push(c);
      }
    }
  }
  return tables;
}

function sampleValue(table, col, i) {
  const n = col.name, t = col.type;
  if (n === 'id') return i + 1;
  if (col.enums.length) return col.enums[i % col.enums.length];
  if (/\[\]$/.test(t)) return [];
  if (/^jsonb?$/.test(t)) {
    if (/'\s*\[/.test(col.def)) return [];
    const o = col.def.match(/'(\{[\s\S]*\})'/);
    if (o) { try { return JSON.parse(o[1]); } catch (_) {} }
    return {};
  }
  if (/^bool/.test(t)) return i === 1;
  if (/^date$/.test(t)) return `2026-03-0${i + 2}`;
  if (/^timestamp/.test(t)) return `2026-03-0${i + 2}T09:00:00.000Z`;
  if (/^(big)?(int|serial)|^smallint|^numeric|^decimal|^real|^double/.test(t)) return /(_id|^id)$/.test(n) ? (i % 3) + 1 : (i + 1) * 100;
  if (/_id$/.test(n)) return String((i % 3) + 1);
  if (/email/.test(n)) return `person${i + 1}@example.com`;
  if (/phone|mobile|whatsapp/.test(n)) return `+97155000000${i}`;
  if (/url$|^avatar|^photo|^logo|^image|^icon$/.test(n)) return '';
  if (/(name|title|subject|label)$/.test(n)) return `Sample ${table} ${i + 1}`;
  return `Sample ${n} ${i + 1}`;
}

function seedTables(schema) {
  const out = {};
  for (const [name, { cols }] of Object.entries(schema)) {
    out[name] = [0, 1, 2].map(i => Object.fromEntries(cols.map(c => [c.name, sampleValue(name, c, i)])));
  }
  // The few that must agree with one another to draw anything.
  out.employees = [
    { id: 1, name: 'Admin Person', username: 'smoke', email: 'a@example.com', password_hash: 'x', job_title: 'Chief Technical Officer', permissions: {}, avatar_url: '', status_text: '', status_emoji: '', created_at: '2026-03-01T09:00:00.000Z' },
    { id: 2, name: 'Sara', username: 'sara', email: 's@example.com', password_hash: 'x', job_title: 'Sales', permissions: {}, avatar_url: '', status_text: 'In a meeting', status_emoji: '📅', created_at: '2026-03-01T09:00:00.000Z' },
    { id: 3, name: 'Omar', username: 'omar', email: 'o@example.com', password_hash: 'x', job_title: 'Logistics', permissions: {}, avatar_url: '', status_text: '', status_emoji: '', created_at: '2026-03-01T09:00:00.000Z' },
  ];
  for (const t of ['sessions', 'push_subscriptions', 'google_tokens', 'quotation_settings', 'login_events', 'account_security', 'password_reset_tokens', 'link_previews']) out[t] = [];
  return out;
}

module.exports = { parseSchema, seedTables };
