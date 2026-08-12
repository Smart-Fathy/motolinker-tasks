// Guest grants: someone outside the room can be pulled into the call by a member,
// but only into the call — never into chat_room_members, and never uninvited.
const fs = require('fs');
const src = fs.readFileSync('index.js', 'utf8');
function slice(from, to) {
  const i = src.indexOf(from); if (i < 0) throw new Error('missing ' + from);
  const j = src.indexOf(to, i); if (j < 0) throw new Error('missing ' + to);
  return src.slice(i, j);
}
const BLOCK = slice('const huddleGuests = new Map();', 'mountChatAdminRoutes(');
for (const f of ['huddleAudience', 'huddleMaySignal'])
  if (!BLOCK.includes(f)) throw new Error('slice missing ' + f);

const sandbox = new Function(BLOCK + `
  return { huddleGuests, huddleAudience, huddleMaySignal };
`)();
const { huddleGuests, huddleAudience, huddleMaySignal } = sandbox;

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const MEMBERS = ['admin', 'employee_2'];
c('a room member may signal', huddleMaySignal(1, 'employee_2', MEMBERS) === true);
c('a stranger may not', huddleMaySignal(1, 'employee_9', MEMBERS) === false);

huddleGuests.set(1, new Set(['employee_9']));
c('a granted guest may signal', huddleMaySignal(1, 'employee_9', MEMBERS) === true);
c('the grant is per room, not global', huddleMaySignal(2, 'employee_9', MEMBERS) === false);

const aud = huddleAudience(1, MEMBERS).sort();
c('roster broadcasts reach members and guests',
  aud.join() === 'admin,employee_2,employee_9', JSON.stringify(aud));
c('and nobody is listed twice',
  huddleAudience(1, ['admin', 'admin', 'employee_2']).filter(k => k === 'admin').length === 1);

huddleGuests.delete(1);
c('once the huddle ends the grant is gone', huddleMaySignal(1, 'employee_9', MEMBERS) === false);

// The route must never write a guest into chat_room_members
const routeSrc = slice("receiver.router.post(`${base}/huddle/signal`", 'const HUDDLE_MAX');
c('the signal route never touches chat_room_members',
  !/chat_room_members/.test(routeSrc.replace(/chatRoomMemberKeys/g, '')));
c('an unknown key cannot be granted', /chatPeopleKeys\(\)/.test(routeSrc) && /unknown person/.test(routeSrc));
c("'media' is an accepted signal type", /'media'/.test(src.match(/const HUDDLE_TYPES = \[[^\]]*\]/)[0]));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
