// Link previews for chat.
//
// Fetching a URL that a user typed is the classic server-side request forgery hole:
// this process can reach the private network and the cloud metadata service, and the
// browser that pasted the link cannot. So the guard below is the point of this file,
// not the Open Graph parsing.
//
// There is no house fetch helper with a timeout anywhere in this codebase — every
// outbound call is a bare fetch — so the timeout, redirect cap and size cap are all
// built here rather than inherited.
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');

const FETCH_TIMEOUT = 5000;      // a preview is decoration; it does not get to hang
const MAX_REDIRECTS = 3;
const MAX_BYTES = 512 * 1024;    // the tags we want are in the <head>
const TTL_DAYS = 7;

// ── Is this address one the browser could not have reached anyway? ────────────
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                              // 10/8
    if (p[0] === 127) return true;                             // loopback
    if (p[0] === 0) return true;                               // this network
    if (p[0] === 169 && p[1] === 254) return true;             // link-local, incl. metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;             // 192.168/16
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;  // IETF protocol assignments
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
    if (p[0] >= 224) return true;                              // multicast and reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd')) return true;  // link-local, ULA
    // ::ffff:10.0.0.1 and friends — an IPv4 address wearing a hat
    const v4 = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return isPrivateAddress(v4[1]);
    return false;
  }
  return true;   // unparseable: refuse rather than guess
}

// Resolved rather than pattern-matched on the hostname, because a name anyone
// controls can point at 127.0.0.1. Every address the name resolves to must be
// public, not merely the first one.
async function assertPublic(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('That address is not reachable from here.');
    return;
  }
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); }
  catch (_) { throw new Error('That host could not be found.'); }
  if (!addrs.length) throw new Error('That host could not be found.');
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error('That address is not reachable from here.');
  }
}

// Redirects are followed by hand so each hop is checked. `redirect: 'follow'` would
// let a public URL bounce straight to 169.254.169.254 with nothing looking at it.
async function safeFetchHtml(startUrl) {
  let url = new URL(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https links can be previewed.');
    await assertPublic(url.hostname);

    const res = await fetch(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: {
        // Identify honestly, and ask for HTML only.
        'User-Agent': 'MotoLinkerBot/1.0 (+link preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    if (!res.ok) throw new Error(`That page answered ${res.status}.`);
    const type = String(res.headers.get('content-type') || '');
    if (!/text\/html|application\/xhtml/i.test(type)) throw new Error('That link is not a web page.');

    // Read up to the cap and stop, rather than trusting content-length.
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) return { html: (await res.text()).slice(0, MAX_BYTES), finalUrl: url.href };
    const chunks = []; let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); total += value.length;
    }
    try { await reader.cancel(); } catch (_) {}
    return { html: Buffer.concat(chunks.map(Buffer.from)).toString('utf8', 0, MAX_BYTES), finalUrl: url.href };
  }
  throw new Error('That link redirects too many times.');
}

// ── Open Graph, with the ordinary tags as a fallback ──────────────────────────
function metaContent(html, patterns) {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1] && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return '';
}
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, ent) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
    if (named[ent.toLowerCase()]) return named[ent.toLowerCase()];
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}
const prop = name => [
  new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
  new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
];

function parsePreview(html, finalUrl) {
  const u = new URL(finalUrl);
  const title = metaContent(html, [...prop('og:title'), ...prop('twitter:title')])
    || (/<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html) || [])[1] || '';
  let image = metaContent(html, [...prop('og:image'), ...prop('og:image:url'), ...prop('twitter:image')]);
  if (image) { try { image = new URL(image, finalUrl).href; } catch (_) { image = ''; } }
  // Never hand back an image on a private host either — the browser would fetch it.
  if (image && !/^https?:$/.test(new URL(image).protocol)) image = '';
  return {
    url: finalUrl,
    domain: u.hostname.replace(/^www\./, ''),
    title: decodeEntities(String(title).replace(/\s+/g, ' ').trim()).slice(0, 200),
    description: metaContent(html, [...prop('og:description'), ...prop('description'), ...prop('twitter:description')]).slice(0, 300),
    siteName: metaContent(html, prop('og:site_name')).slice(0, 100),
    image: image.slice(0, 1000),
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// A link pasted in a busy room is fetched once, not once per person who scrolls past
// it. The table survives restarts; the map in front of it absorbs the burst when a
// room full of people load the same thread at once.
const _mem = new Map();          // hash → { at, data }
const MEM_TTL = 60000;
const hashOf = url => crypto.createHash('sha256').update(url).digest('hex');

async function cachedPreview(url) {
  const hash = hashOf(url);
  const hit = _mem.get(hash);
  if (hit && Date.now() - hit.at < MEM_TTL) return hit.data;

  try {
    const { data } = await supabase.from('link_previews').select('*').eq('url_hash', hash).single();
    if (data && data.fetched_at && Date.now() - new Date(data.fetched_at).getTime() < TTL_DAYS * 864e5) {
      const row = { url: data.url, domain: data.domain, title: data.title, description: data.description,
                    siteName: data.site_name, image: data.image };
      _mem.set(hash, { at: Date.now(), data: row });
      return row;
    }
  } catch (_) { /* no cached row, or the table is not there yet — just fetch it */ }

  const { html, finalUrl } = await safeFetchHtml(url);
  const meta = parsePreview(html, finalUrl);
  _mem.set(hash, { at: Date.now(), data: meta });
  if (_mem.size > 500) for (const [k, v] of _mem) if (Date.now() - v.at >= MEM_TTL) _mem.delete(k);
  try {
    await supabase.from('link_previews').upsert({
      url_hash: hash, url: meta.url, domain: meta.domain, title: meta.title,
      description: meta.description, site_name: meta.siteName, image: meta.image,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'url_hash' });
  } catch (e) { console.warn('[link-preview] cache write failed:', e.message); }
  return meta;
}

async function handleLinkPreview(req, res) {
  const raw = String((req.body && req.body.url) || '').trim();
  if (!raw) return res.status(400).json({ error: 'A url is required.' });
  if (raw.length > 2000) return res.status(400).json({ error: 'That link is too long.' });
  let parsed;
  try { parsed = new URL(raw); } catch (_) { return res.status(400).json({ error: 'That is not a link.' }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http and https links can be previewed.' });
  }
  try {
    res.json(await cachedPreview(parsed.href));
  } catch (e) {
    // A preview that cannot be built is not an error the user needs to act on.
    res.status(200).json({ url: parsed.href, domain: parsed.hostname.replace(/^www\./, ''), title: '', error: e.message });
  }
}

receiver.router.post('/api/dashboard/link-preview', requireAuth, express.json({ limit: '4kb' }), handleLinkPreview);
receiver.router.post('/api/employee/link-preview', requireEmployeeAuth, express.json({ limit: '4kb' }), handleLinkPreview);

module.exports = { isPrivateAddress, assertPublic, parsePreview, safeFetchHtml };
