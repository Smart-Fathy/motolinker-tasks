// How a phone number is written down, everywhere.
//
// This has to be ONE function. `customers.phone_norm` is written by the lead
// importer and the automation rules; the customer portal proves ownership by
// comparing against it. A portal that normalised even slightly differently
// would reject people who typed their own number correctly, and the failure
// would look like "the customer is lying about their number".
// An Egyptian mobile written every way a person writes it, reduced to the one
// form everything else compares against: 01XXXXXXXXX.
//
//   01000500577      typed locally
//   +20 1000500577   country code, local part without its 0
//   +20 01000500577  country code in front of the WHOLE local number
//   0020 …           the same thing with the international prefix spelled out
//
// The third shape was the gap: 28 customer records normalised to
// 2001000500577 and matched nothing, so those people were invisible to the
// duplicate check on import and would be unable to prove ownership of their
// own car. `20` is only stripped when what follows is itself a valid Egyptian
// mobile, so a foreign number that happens to begin 20 is left alone.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0020')) d = d.slice(4);
  // +20 then 01XXXXXXXXX — the country code in front of the full local number.
  else if (/^20(01[0-9]{9})$/.test(d)) d = d.slice(2);
  // +20 then 1XXXXXXXXX — the country code in front of the local part.
  else if (/^20(1[0-9]{9})$/.test(d)) d = '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  return d;
}

module.exports = { normalizePhone };
