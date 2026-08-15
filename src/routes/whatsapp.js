// WhatsApp Inbox
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { crypto, express, path, receiver, requireAuth, sendPushToOfflineMembers, supabase } = ctx.need('crypto', 'express', 'path', 'receiver', 'requireAuth', 'sendPushToOfflineMembers', 'supabase');

// ─── WhatsApp Inbox (whatsapp-web.js) ──────────────────────────────────────────
// Self-contained bridge: one long-lived WhatsApp Web client, linked by QR code.
// Guarded by WHATSAPP_ENABLED so the module is fully inert when not configured.
const waSseClients = new Set();         // Set<res> — admin dashboard SSE listeners
let waClient       = null;              // whatsapp-web.js Client instance
let waInitializing = false;
let waStatus       = 'disconnected';    // 'disconnected' | 'qr' | 'connecting' | 'ready'
let waLastQr       = null;              // data-URL of the current link QR (when status==='qr')

function waBroadcast(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of waSseClients) { try { res.write(data); } catch (_) {} }
}

function waSetStatus(status, qr) {
  waStatus = status;
  waLastQr = (status === 'qr') ? (qr || waLastQr) : null;
  waBroadcast('whatsapp_status', { status: waStatus, qr: waLastQr });
}

// Upsert a contact by wa_id, returning the row.
async function upsertWaContact(waId, name, preview, incInc) {
  const patch = { wa_id: waId, phone: (waId.split('@')[0] || ''), updated_at: new Date().toISOString() };
  if (name) patch.name = name;
  if (preview !== undefined) { patch.last_message_preview = preview; patch.last_message_at = new Date().toISOString(); }
  // Upsert basic identity first
  const { data: existing } = await supabase.from('whatsapp_contacts').select('*').eq('wa_id', waId).single();
  if (!existing) {
    const { data } = await supabase.from('whatsapp_contacts')
      .insert({ ...patch, name: name || '', unread: incInc ? 1 : 0 }).select().single();
    return data;
  }
  if (incInc) patch.unread = (existing.unread || 0) + 1;
  const { data } = await supabase.from('whatsapp_contacts').update(patch).eq('id', existing.id).select().single();
  return data || existing;
}

async function initWhatsApp() {
  if (waClient || waInitializing) return;
  waInitializing = true;
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcode = require('qrcode');
    waSetStatus('connecting');
    waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: process.env.WHATSAPP_SESSION_PATH || './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
               '--no-first-run','--no-zygote','--single-process','--disable-gpu'],
      },
    });

    waClient.on('qr', async (qr) => {
      try { waSetStatus('qr', await qrcode.toDataURL(qr)); }
      catch (e) { console.error('[whatsapp] qr render', e); }
    });
    waClient.on('authenticated', () => waSetStatus('connecting'));
    waClient.on('ready',        () => { console.log('[whatsapp] ready'); waSetStatus('ready'); });
    waClient.on('disconnected', (reason) => { console.warn('[whatsapp] disconnected', reason); waClient = null; waSetStatus('disconnected'); });
    waClient.on('message', (msg) => handleWaIncoming(msg).catch(e => console.error('[whatsapp] incoming', e)));

    await waClient.initialize();
  } catch (e) {
    console.error('[whatsapp] init failed', e);
    waClient = null;
    waSetStatus('disconnected');
  } finally {
    waInitializing = false;
  }
}

async function handleWaIncoming(msg) {
  // Only handle 1:1 chats (ignore groups, status broadcasts, newsletters)
  if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us') || msg.from.endsWith('@newsletter')) return;
  if (msg.isStatus) return;

  let contactName = '';
  try { const c = await msg.getContact(); contactName = c.pushname || c.name || c.verifiedName || ''; } catch (_) {}

  // Download media (images/docs) → existing chat-files bucket
  let media_url = null, media_type = null;
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        const ext  = (media.mimetype.split('/')[1] || 'bin').split(';')[0];
        const path = `whatsapp/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
        const buf  = Buffer.from(media.data, 'base64');
        const { data: up, error } = await supabase.storage.from('chat-files').upload(path, buf, { contentType: media.mimetype, upsert: false });
        if (!error) { media_url = supabase.storage.from('chat-files').getPublicUrl(up.path).data.publicUrl; media_type = media.mimetype; }
      }
    } catch (e) { console.error('[whatsapp] media download', e); }
  }

  const preview = msg.body ? msg.body.slice(0, 80) : (media_type ? '📎 Attachment' : '');
  const contact = await upsertWaContact(msg.from, contactName, preview, true);
  if (!contact) return;

  const { data: saved } = await supabase.from('whatsapp_messages').insert({
    contact_id: contact.id, wa_message_id: msg.id?._serialized || null, direction: 'in',
    body: msg.body || '', media_url, media_type, status: 'received',
    ts: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
  }).select().single();

  waBroadcast('whatsapp_message', { contact, message: saved });
  sendPushToOfflineMembers(['admin'], {
    type: 'whatsapp_message', senderName: `WhatsApp · ${contact.name || contact.phone}`,
    body: preview || 'New message', roomId: contact.id,
  }).catch(() => {});
}

async function sendWaMessage(waId, body) {
  if (!waClient || waStatus !== 'ready') throw new Error('WhatsApp is not connected');
  const sent = await waClient.sendMessage(waId, body);
  const contact = await upsertWaContact(waId, '', body.slice(0, 80), false);
  const { data: saved } = await supabase.from('whatsapp_messages').insert({
    contact_id: contact.id, wa_message_id: sent?.id?._serialized || null, direction: 'out',
    body, status: 'sent', ts: new Date().toISOString(),
  }).select().single();
  waBroadcast('whatsapp_message', { contact, message: saved });
  return { contact, message: saved };
}

// ── WhatsApp routes (admin only) ──
receiver.router.get('/api/dashboard/whatsapp/events', requireAuth, (req, res) => {
  res.set(ctx.SSE_HEADERS);
  res.flushHeaders();
  res.write(':ok\n\n');
  waSseClients.add(res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); waSseClients.delete(res); });
});

receiver.router.get('/api/dashboard/whatsapp/status', requireAuth, (_req, res) => {
  res.json({ enabled: process.env.WHATSAPP_ENABLED === 'true', status: waStatus, qr: waLastQr });
});

receiver.router.post('/api/dashboard/whatsapp/connect', requireAuth, (_req, res) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return res.status(400).json({ error: 'WhatsApp is disabled (set WHATSAPP_ENABLED=true)' });
  initWhatsApp().catch(e => console.error('[whatsapp] connect', e));
  res.json({ ok: true, status: waStatus });
});

receiver.router.post('/api/dashboard/whatsapp/logout', requireAuth, async (_req, res) => {
  try {
    if (waClient) { try { await waClient.logout(); } catch (_) {} try { await waClient.destroy(); } catch (_) {} }
  } finally {
    waClient = null;
    waSetStatus('disconnected');
  }
  res.json({ ok: true });
});

receiver.router.get('/api/dashboard/whatsapp/contacts', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('whatsapp_contacts').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/whatsapp/contacts/:id/messages', requireAuth, async (req, res) => {
  // Pure read — no state mutation (clearing unread is an explicit POST .../read to avoid a lost-update race)
  const { data, error } = await supabase.from('whatsapp_messages').select('*').eq('contact_id', req.params.id).order('created_at', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Explicit mark-conversation-read (called when the admin opens/focuses a conversation)
receiver.router.post('/api/dashboard/whatsapp/contacts/:id/read', requireAuth, async (req, res) => {
  const { error } = await supabase.from('whatsapp_contacts').update({ unread: 0 }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

receiver.router.post('/api/dashboard/whatsapp/contacts/:id/messages', requireAuth, express.json(), async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  const { data: contact } = await supabase.from('whatsapp_contacts').select('*').eq('id', req.params.id).single();
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  try {
    const result = await sendWaMessage(contact.wa_id, body);
    res.json(result.message);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/whatsapp/send', requireAuth, express.json(), async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/[^\d]/g, '');
  const body  = (req.body?.body || '').trim();
  if (!phone || !body) return res.status(400).json({ error: 'phone and body are required' });
  try {
    const result = await sendWaMessage(`${phone}@c.us`, body);
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});


module.exports = { initWhatsApp };
