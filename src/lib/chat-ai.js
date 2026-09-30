// The assistant inside the team chat.
//
// Anyone in a room can write "@AI what does Ahmed still owe?" and the answer
// arrives as a message in that room, from a sender called AI Assistant, for
// everyone in the room to see. The routes do the talking (src/routes/
// notifications.js spots the mention, src/routes/assistant.js answers); what
// lives here is pure — the mention grammar, the transcript the model reads,
// the sender's identity and avatar — so tests can pin it down without a
// database or a model.
const ASSISTANT_KEY = 'assistant';
const ASSISTANT_NAME = 'AI Assistant';

// "@AI", "@assistant", "@bot", "@motolinker", and the Arabic "@المساعد" /
// "@الذكاء" — at the start or after a space or bracket, and not glued to a
// longer word, so an email address or "@aisha" is left alone.
const MENTION_RE = /(^|[\s(\[،,"'«])@(ai|assistant|motolinker|bot|المساعد|الذكاء)(?![\w؀-ۿ.-])/i;
const MENTION_ALL_RE = new RegExp(MENTION_RE.source, 'gi');
function mentionsAssistant(body) { return MENTION_RE.test(String(body || '')); }
// The question without the address: "@AI what is owed" → "what is owed".
function stripMention(body) {
  return String(body || '').replace(MENTION_ALL_RE, '$1').replace(/\s+([,،.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

// The last messages of the room as the model should read them, oldest first.
function transcriptOf(rows, opts) {
  const limit = Math.max(1, (opts && opts.limit) || 20);
  const list = (Array.isArray(rows) ? rows : []).slice(-limit);
  return list.map(m => {
    const at = String(m.created_at || '').slice(11, 16);
    const who = m.sender_key === ASSISTANT_KEY ? ASSISTANT_NAME : (m.sender_name || m.sender_key || 'someone');
    const body = String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 300) || (m.file_name ? `📎 ${m.file_name}` : m.file_url ? '📎 attachment' : '');
    return `${at ? at + ' ' : ''}${who}: ${body}`;
  }).join('\n');
}

// The sender's avatar: the same gradient brain as the Ask AI button, as a data
// URI so no file has to ship and the chat's avatar plumbing needs no change.
const ASSISTANT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f472b6"/><stop offset=".45" stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs>'
  + '<circle cx="20" cy="20" r="20" fill="#17171b"/><g fill="none" stroke="url(#g)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(8 8)">'
  + '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>'
  + '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></g></svg>');

module.exports = { ASSISTANT_KEY, ASSISTANT_NAME, ASSISTANT_AVATAR, MENTION_RE, mentionsAssistant, stripMention, transcriptOf };
