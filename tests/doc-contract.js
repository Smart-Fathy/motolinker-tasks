// The car-sale (import) contract — "عقد بيع سيارة استيراد" — in Arabic, right to left.
//
//   src/lib/docs/contract-sale-text.js   the legal wording (plain constants)
//   src/lib/docs/contract.js             the look, and the dispatcher that keeps an older contract
//                                        on the words it was signed on
//   src/routes/contracts.js              defaults, the auto-draft, the PDF routes (the number)
//   public/assets/procurement.js         the editor (openContractForm / ctCollect)
//
// What this guards, in order: the wording (the new text, nine clauses, in order, the typos of
// the source kept); the blanks (an empty value is a dotted line, a filled one is in its place,
// escaped, isolated from the Arabic around it); the dispatcher and the frozen legacy wording;
// the payment lines; the number in the header; the server side (new contracts are sale-v2,
// the number follows the contract); the layout in a real browser (nothing overflows) and in a
// real PDF (it paginates, no heading is stranded, the signatures never stand alone); and the
// editor, which shows the right fields for each template.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Use the sandbox's Chrome when puppeteer has none of its own (read once, at load).
if (!process.env.PUPPETEER_EXECUTABLE_PATH && !fs.existsSync(path.join(process.env.HOME || '/root', '.cache', 'puppeteer', 'chrome'))) {
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (fs.existsSync(exe)) process.env.PUPPETEER_EXECUTABLE_PATH = exe;
}
const puppeteer = require('puppeteer');
const T = require('../src/lib/docs/contract-sale-text');
const { SALE_TEMPLATE, buildContractHtml, buildSaleContractHtml } = require('../src/lib/docs/contract');
const { buildLegacyContractHtml } = require('../src/lib/docs/contract-legacy');
const { renderPdf } = require('../src/lib/docs/render');
const fx = require('../tools/doc-fixtures/contract');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// poll until a condition holds (a slow machine must not turn a race into a failure), at most `ms`
const waitFor = async (cond, ms = 4000) => { for (let t = 0; t < ms && !cond(); t += 50) await sleep(50); return cond(); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const have = cmd => spawnSync('which', [cmd]).status === 0;

// ── Reading a document the way a reader does ───────────────────────────────────
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const squash = s => s.replace(/\s+/g, ' ').trim();
// The contract's own pages (not the letterhead): block ends become spaces, inline tags vanish.
const bodyOf = html => html.slice(html.indexOf('<table class="flow">'));
const plain = html => squash(decode(bodyOf(html)
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<\/(p|li|h[1-6]|div|tr|section|header|table|th|td|ol|ul)>|<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/\u200b/g, '')));
const count = (hay, needle) => hay.split(needle).length - 1;
const expand = (t, vals) => t.replace(/\{([^}]+)\}/g, (_, k) => (vals && vals[k]) || '');
// every position a list of phrases is found at, each after the one before it (or -1)
const inOrder = (text, phrases) => {
  let at = 0;
  for (const p of phrases) { const i = text.indexOf(p, at); if (i < 0) return p; at = i + p.length; }
  return -1;
};

const filledHtml = buildContractHtml(fx.contract);
const blankHtml = buildContractHtml(fx.contractBlank);
const filledText = plain(filledHtml), blankText = plain(blankHtml);

// ── The wording, as it reads in the uploaded PDF ────────────────────────────────
// Typed from the page images of the source, NOT taken from the constants, so that a change to
// the constants (a "corrected" typo, a sentence from the old contract) shows up here. The
// source's own oddities are part of it: "لعربية", "يقرالطرف", "بطربق", "الشاسية".
const ANCHORS = [
  'عقد بيع سيارة استيراد',
  'إنه في يوم', 'الموافق', 'حرر بين كلا من -:',
  'أولا -: شركة /', '( ش . . )', 'سجل تجاري رقم', 'بطاقة ضريبية رقم :', 'ومقرها', 'ويمثلها في هذا العقد',
  'السيد /', 'ويحمل بطاقة رقم قومي', 'صادرة بتاريخ', 'الجنسية', 'الديانة', 'ومقيم:', 'وذلك بصفه', 'عن الشركة بموجب تفويض خاص بذلك .',
  '( ويشار إليه في هذا العقد بالطرف الأول – المستورد – صاحب الترخيص - البائع )',
  'ثانيا : السيد /',
  '( ويشار إليه في هذا العقد بالطرف الثاني – المشتري )',
  'أقر المتعاقدان علي أهليتهما للتصرف وأتفقا علي ما يأتي :',
  'تمهيد', 'حيث أن الطرف الأول هي شركة منشأة طبقا لقوانين جمهورية مصر لعربية ،', 'ومتخصصة ومرخص لها بإستيراد وتجارة السيارات من الخارج لداخل مصر',
  'ولما كان الطرف الثاني يرغب في شراء سيارة إستيراد طبقا للمواصفات الموضحة بالبند الثاني من هذا العقد',
  'علي أن يتم الإستيراد تحت مسئولية الطرف الأول ولحساب الطرف الثاني', 'وإتفقا علي ما يلي :',
  'البند الأول', 'يعتبر التمهيد الوارد بهذا العقد', 'ويقر الطرفان بان هذا العقد يعد عقد وكاله بالعمولة لاستيراد سيارة لحساب الطرف الثاني', 'والتخليص الجمركي .',
  'البند الثاني', 'إتفق طرفي هذا العقد علي أن يقوم الطرف الأول بما له من خبرة وإمكانية في بيع سيارة إستيراد الأتي بيانها لحساب الطرف الثاني', 'وذلك علي النحو التالي :',
  'ماركة السيارة', 'موديل السيارة', 'اللون', 'سنة الصنع', 'ملاحظات',
  'ويقر الطرف الثاني أنه قد عاين تفاصيل ومواصفات السيارة السالف بيانها المعاينه النافية للجهالة', 'تعد غير قابلة لآية تعديلات .',
  'البند الثالث', 'إتفق طرفا هذا العقد علي أن يلتزم الطرف الثاني بأن يسدد للطرف الأول نظير قيام الأخير بعملية شراء السيارة', 'داخل مصر مبلغاً قدره', '( فقط', 'لا غير ) بالجنيه المصري',
  'وهذا المبلغ يشمل ثمن شراء وإستيراد السيارة وعمولة الطرف الأول بالإضافة إلي كافة الرسوم والضرائب والجمارك في دولة المورد أو داخل مصر، وكذلك أجور الشحن والنقل :',
  'مبلغ قدره', 'يتم سداده', 'فور التوقيع علي هذا العقد.',
  'البند الرابع', 'إتفق الطرفان علي أن يتم تنفيذ العقد واستلام السيارة وتسليمها للطرف الثاني بعد وصول التحويل البنكي او صرف مبلغ الشيك في حالة عدم الدفع نقدا',
  'البند الخامس', 'يلتزم الطرف الأول بالأتي:',
  'بتسليم الطرف الثاني السيارة واستيفاء الأوراق اللازمة بالجمرك لتسجيلها ونقل ملكيتها باسم الطرف الثاني والمحافظة عليها وقت تسليمها.',
  'يقر الطرف الأول بصحة جميع الأوراق الخاصة بالسيارة ومطابقتها للشروط والمواصفات المتفق عليها الواردة بكتالوج السيارة.',
  'يقرالطرف الأول بإلتزامه بتسليم السيارة للطرف الثاني دون وجود أي عيوب ظاهرة او غير ظاهرة بالسيارة وخاصة تغيير هيكل السيارة أو وجود بارومة أو أجراء تعديل على الماتور أو الشاسية أو تغيير الفتيس أو تعديله.',
  'يلتزم الطرف الثاني بالأتي :',
  'بسداد المبلغ المذكور بالبند الثالث من هذا العقد طبقا للقيم والدفعات والمواعيد المتفق عليها في هذا العقد.',
  'بإستلام السيارة خلال أسبوع من الموعد المتفق عليه بالبند الرابع من هذا العقد عقب إخطاره من الطرف الأول رسميا بذلك.',
  'يلتزم الطرف الثاني بأن يتسلم السيارة بشخصه أو من ينوب عنه بموجب توكيل رسمي بذلك .ولا يتم التعامل بأي تفويضات أو غير ذلك من المستندات .',
  'البند السادس', 'في حال تراجع الطرف الثاني عن إتمام تنفيذ هذا العقد عقب توقيعه وقبل استلام السيارة محل هذا التعاقد ، فإنه يلزم بأن يدفع للطرف الأول مبلغا وقدره 10% من قيمه السيارة المدونة اعلاه',
  'البند السابع', 'من اختصاص محكمة شمال القاهرة الإبتدائية وجزئياتها', 'أو بخطاب موصي عليه بعلم الوصول .',
  'البند الثامن', 'يخضع هذا العقد ويتم تفسيره طبقًا لقوانين جمهورية مصر العربية', 'سواء بالكتابة أو شفويًا', 'إلا بطربق الكتابة وتوقيع أطرافه الموضحين بأول هذا العقد .',
  'البند التاسع', 'تحرر هذا العقد من تسعة بنود يقر كل من الطرفين بعلمه بكل ما جاء بها من شروط وأحكام ولا يجوز الرجوع فيها بعد توقيعه علي العقد وتحرر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها.',
  'الطرف الأول', 'الاسم', 'الرقم القومي', 'التوقيع', 'الطرف الثاني', 'الاسم', 'الرقم القومي', 'التوقيع',
];
// What the OLD contract says and the new one does not.
const OLD_ONLY = ['عقد شراء وإستيراد سيارة لحساب الغير', 'عشرة بنود', 'غرامة تأخير', 'بدون الشحن والجمارك', 'علي أن يتم الإستيراد من دولة', 'في موعد غايته',
  'كشرط جزائي نهائي', 'ولا يجوز الغاء التعاقد بعد شحن السيارة', 'وجلب السيارة لتسليمها للطرف الثاني', 'بإستيراد السيارة بناء علي طلب الطرف الثاني'];

// ── Values that sit in exactly one blank ─────────────────────────────────────────
const F = fx.contract;

(async () => {
  // ═══ 1. The wording ═══
  check('the new contract: nine clauses, "تمهيد" before the first, in the order of the source',
    T.CLAUSES.length === 9 && T.PREAMBLE.heading === 'تمهيد'
    && T.CLAUSES.map(c => c.heading).join('|') === 'البند الأول|البند الثاني|البند الثالث|البند الرابع|البند الخامس|البند السادس|البند السابع|البند الثامن|البند التاسع');
  const miss = inOrder(filledText, ANCHORS);
  check('every sentence of the uploaded contract is printed, in order, as the source words it', miss === -1, miss === -1 ? `${ANCHORS.length} phrases` : `missing or out of order: ${miss}`);
  const missBlank = inOrder(blankText, ANCHORS);
  check('…and a blank contract prints the very same words around its blanks', missBlank === -1, String(missBlank));
  check('the clauses read from the constants: each paragraph, with its blanks filled, is in the page',
    T.CLAUSES.every(c => c.blocks.every(b => {
      const vals = { total: '1,915,050', totalWords: F.totalWords };
      const texts = b.t === 'p' ? [expand((b.lead ? b.lead + ' ' : '') + b.text, vals)] : b.t === 'ol' ? b.items.map(i => i.text) : b.t === 'sub' ? [b.text] : [];
      return texts.every(t => filledText.includes(squash(t)));
    })));
  const gone = OLD_ONLY.filter(w => filledHtml.includes(w) || filledText.includes(w));
  check('nothing of the old contract\'s wording is in the new one', gone.length === 0, gone.join(' | '));
  check('"تسعة بنود" — the new contract says nine, and has nine', filledText.includes('من تسعة بنود') && !filledText.includes('عشرة'));
  check('the source\'s typos are kept as written, for the owner to decide (none is corrected here)',
    ['مصر لعربية', 'يقرالطرف', 'بطربق', 'الشاسية', 'لآية', 'وكاله بالعمولة', '( ش . . )'].every(w => filledText.includes(w)));
  check('the vehicle table has the five rows of the paper form, label and value',
    T.VEHICLE_ROWS.map(r => r[0]).join('|') === 'ماركة السيارة|موديل السيارة|اللون|سنة الصنع|ملاحظات'
    && T.VEHICLE_ROWS.map(r => r[1]).join('|') === 'make|model|color|year|notes'
    && count(filledHtml, '<th>') === 5);
  // The wording is the company's: changing it is a decision, not a side effect. If the owner approves
  // a correction, change the text, the ANCHORS above, and this digest together.
  const digest = sha(JSON.stringify([T.TITLE, T.DATE_LINE, T.FIRST_PARTY, T.SECOND_PARTY, T.ACCEPT, T.PREAMBLE, T.VEHICLE_ROWS, T.DEFAULT_PAYMENT_WHEN, T.PAYMENT_LINE, T.CLAUSES, T.SIGNATURE]));
  check('the wording constants are exactly the transcribed text (pinned digest)', digest === '45c74cbea1d6cecb91e7ebb64dd07fb70d35787fb5c1dd8edcd6e671aa62eadf', digest);

  // ═══ 2. Blanks ═══
  const tokens = s => (s.match(/\{[^}]+\}/g) || []).length;
  const tokenCount = tokens(T.DATE_LINE) + tokens(T.FIRST_PARTY.company) + tokens(T.FIRST_PARTY.person) + tokens(T.SECOND_PARTY.person)
    + T.CLAUSES.flatMap(c => c.blocks).reduce((n, b) => n + (b.t === 'p' ? tokens(b.text) + tokens(b.lead || '') : 0), 0)
    + 1                                   // the amount of the one payment line (its wording is pre-printed)
    + T.VEHICLE_ROWS.length               // the vehicle table
    + 4;                                  // name and national ID in the two signature boxes
  const blanksIn = h => (bodyOf(h).match(/<span class="b b-\w+"><\/span>/g) || []).length;
  check('every blank of the paper form prints as a dotted leader when empty', blanksIn(blankHtml) === tokenCount, `${blanksIn(blankHtml)} of ${tokenCount}`);
  check('…and a fully filled contract has none left (no token goes unfilled)', blanksIn(filledHtml) === 0, String(blanksIn(filledHtml)));
  check('the leader is a dotted line drawn by the page, not typed dots that bidi could scatter',
    /\.b\{[^}]*border-bottom:[^;}]*dotted/.test(blankHtml) && !/\.{4,}/.test(bodyOf(blankHtml).replace(/<style[\s\S]*?<\/style>/g, '')));
  check('the pre-printed words survive an empty contract: the payment wording, the clause text',
    blankText.includes('مبلغ قدره يتم سداده فور التوقيع علي هذا العقد.'));
  const partial = buildContractHtml({ template: SALE_TEMPLATE, buyer: { name: 'سعيد', nationality: '', religion: 'مسلم' }, rep: { name: '  ' }, company: { repIn: 'محمد' }, contractDate: { d: '5' } });
  const partialText = plain(partial);
  check('a field cleared in the editor is a blank again; a half-filled date keeps its blanks',
    !/\{/.test(partialText)
    && partial.includes('<bdi class="dt" dir="ltr"><bdi class="v v--nw">5</bdi> / <span class="b b-xs"></span> / <span class="b b-s"></span></bdi>')
    && partial.includes('<span class="b b-s"></span> الجنسية ،') && /<bdi class="v v--nw">مسلم<\/bdi> الديانة/.test(partial));
  check('the representative named once stands in the other blank too',
    plain(partial).includes('السيد / محمد') && plain(partial).includes('ويمثلها في هذا العقد محمد'));

  // ═══ 3. Values: in place, once, escaped, isolated ═══
  const body = bodyOf(filledHtml);
  const once = [['282378', 1], ['773934006', 1], ['15/03/2022', 1], ['02/08/2021', 1], ['12 شارع النصر - مدينة نصر - القاهرة', 1], ['مصر الجديدة - القاهرة', 1],
    ['1,915,050', 1], [F.totalWords, 1], ['1,340,535', 1], ['EZ60 EV 600 Max', 1], ['شاحن حائط وكابل ومجموعة إصلاح الإطارات', 1], ['مدير الشركة', 1]];
  const bad = once.filter(([v, n]) => count(filledText, v) !== n);
  check('a filled value is printed once, in its own blank', bad.length === 0, bad.map(b => b[0]).join(' | '));
  check('the two people named in the signature boxes are named there as well (twice in all), and only there',
    count(filledText, F.buyer.nationalId) === 2 && count(filledText, F.rep.nationalId) === 2 && count(filledText, F.buyer.name) === 2 && count(filledText, F.rep.name) === 3);
  check('every value sits in its own <bdi> isolate: an ID, a date, an amount, a name cannot reorder the Arabic around it',
    [F.rep.nationalId, F.buyer.nationalId, '15/03/2022', '1,915,050', F.buyer.name, F.company.name].every(v => new RegExp(`<bdi class="v[^"]*">${v}</bdi>`).test(body))
    && !/<bdi class="v[^"]*"><\/bdi>/.test(body));
  check('the date reads left to right as one unit: day / month / year',
    /<bdi class="dt" dir="ltr"><bdi class="v v--nw">12<\/bdi> \/ <bdi class="v v--nw">10<\/bdi> \/ <bdi class="v v--nw">2026<\/bdi><\/bdi>/.test(body));
  check('the amount is grouped by thousands; words and anything typed with its own punctuation are left alone',
    filledText.includes('1,915,050') && !filledText.includes('1915050') && plain(buildContractHtml({ ...F, total: '٥٠٠ ألف', payments: [{ amount: '2,5 مليون' }] })).includes('٥٠٠ ألف')
    && plain(buildContractHtml({ ...F, total: 1234567 })).includes('1,234,567'));

  const hostile = buildContractHtml(fx.contractHostile);
  check('markup in a field is text: nothing of it survives as a tag',
    !/<img src=x/.test(hostile) && !/<h1>boom/.test(hostile) && !/<\/u><h1>/.test(hostile)
    && hostile.includes('&lt;img src=x onerror=alert(1)&gt;') && hostile.includes('&lt;/u&gt;&lt;h1&gt;boom&lt;/h1&gt;'));
  check('…and it reads as typed, quotes and ampersand included', plain(hostile).includes('<img src=x onerror=alert(1)> "عمر" & Sons') && plain(hostile).includes('</u><h1>boom</h1>'));
  const evil = buildContractHtml({ ...F, contractNo: '"><script>alert(1)</script>', settings: { company_email: '<b>x</b>' }, company: { ...F.company, address: '<i>addr</i>' },
    vehicle: { ...F.vehicle, make: '<svg onload=1>' }, payments: [{ amount: '<b>1</b>', when: '<u>x</u>', label: '<em>l</em>' }] });
  check('the number, the letterhead, the table, the payments: all escaped too',
    !/<script|<svg|<b>x|<i>addr|<b>1|<u>x|<em>l/.test(evil.slice(evil.indexOf('<body'))) && /&lt;script&gt;/.test(evil) && /&lt;svg onload=1&gt;/.test(evil));
  const junk = buildContractHtml({ template: SALE_TEMPLATE, company: 'x', rep: [1], buyer: null, vehicle: 7, contractDate: 'now', payments: 'many', total: { a: 1 }, totalWords: [], contractNo: {} });
  check('nonsense in the payload prints blanks, never "undefined", "NaN" or "[object Object]"',
    !/undefined|NaN|\[object/.test(plain(junk)) && plain(junk).includes('عقد بيع سيارة استيراد') && !/dh-ref">/.test(junk));
  const junky = Object.entries(fx).filter(([name]) => name !== 'contractLegacy').map(([name, data]) => [name, plain(buildContractHtml(data))])
    .filter(([, t]) => /undefined|NaN|\[object|null/.test(t)).map(([name]) => name);
  check('no fixture prints "undefined", "NaN" or "null"', junky.length === 0, junky.join(', '));
  const withOld = buildContractHtml({ ...F, importCountry: 'اليابان-XYZ', lateFee: '77777', lateFeeWords: 'سبعة-XYZ', deliveryDeadline: '99 يوما-XYZ' });
  check('the old contract\'s own fields (import country, late fee, delivery deadline) are no part of the new one: not printed even if the payload still carries them',
    withOld === filledHtml && !/XYZ|77777/.test(plain(withOld)));

  // ═══ 4. Which wording a contract is on ═══
  const legacyPayload = fx.contractLegacy;
  const legacyHtml = buildContractHtml(legacyPayload);
  check('the dispatcher: sale-v2 is the new contract', buildContractHtml({ template: 'sale-v2' }).includes('عقد بيع سيارة استيراد') && SALE_TEMPLATE === 'sale-v2');
  const others = [undefined, null, {}, { template: '' }, { template: 'legacy' }, { template: 'sale-v1' }, { template: 'SALE-V2' }, { template: ['sale-v2'] }];
  check('…anything else — no template, another one — is the old contract, with its old words',
    others.every(o => { const h = buildContractHtml(o); return h.includes('عقد شراء وإستيراد سيارة لحساب الغير') && !h.includes('عقد بيع سيارة استيراد') && !h.includes('class="doc"'); }));
  check('a saved contract re-exports with the words it was signed on: its HTML is the legacy module\'s, byte for byte',
    legacyHtml === buildLegacyContractHtml(legacyPayload) && legacyHtml === buildContractHtml({ ...legacyPayload, contractNo: 'MC2501-1' }));
  check('…and its wording is the original: ten clauses named "عشرة بنود", late fee, deadline, the import country',
    ['عشرة بنود', 'عقد شراء وإستيراد سيارة لحساب الغير', 'غرامة تأخير', 'الصين', 'خمسمائة', '45 يوما', 'دفعة الشحن', 'في موعد غايته'].every(w => legacyHtml.includes(w)) && !/تسعة بنود/.test(legacyHtml));
  // Pinned from the legacy module's own output for the 'contractLegacy' fixture, before the sale contract existed.
  // If this fails, the old contract's rendering has changed: restore it. Do not re-pin to make it pass. (The one
  // legitimate reason to re-pin: the logo URL in src/lib/constants.js is part of that HTML, and was changed on purpose.)
  check('REGRESSION GUARD: the legacy HTML of the "contractLegacy" fixture is unchanged (sha256)',
    sha(legacyHtml) === '441415c291192b2273545444acf9830d3e48e1a45801f616c41a3ad619e63022', sha(legacyHtml));

  // ═══ 5. Payment lines ═══
  const longHtml = buildContractHtml(fx.contractLong);
  const payItems = h => [...bodyOf(h).matchAll(/<ol class="pay">([\s\S]*?)<\/ol>/g)].flatMap(m => [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => x[1]));
  const longPays = payItems(longHtml).map(h => plain('<table class="flow">' + h));
  check('several payment lines: all printed, in order, each with its wording, label and a full stop',
    longPays.length === 3 && longPays[0] === 'مبلغ قدره 500,000 يتم سداده فور التوقيع علي هذا العقد.'
    && longPays[1] === 'مبلغ قدره 600,000 يتم سداده عند وصول السيارة الي الموانئ المصرية ( دفعة الشحن ).'
    && longPays[2] === 'مبلغ قدره 815,050 يتم سداده عند استلام السيارة.', JSON.stringify(longPays));
  check('the list is numbered by the page (a counter), and kept together on a page',
    /ol\.pay li::before\{content:counter\(i\)/.test(longHtml) && /ol\.pay\{[^}]*break-inside:avoid/.test(longHtml));
  const none = buildContractHtml({ template: SALE_TEMPLATE });
  check('no payment line at all prints the one line of the paper form, blank, with its pre-printed wording',
    payItems(none).length === 1 && plain('<table class="flow">' + payItems(none)[0]) === 'مبلغ قدره يتم سداده فور التوقيع علي هذا العقد.' && /class="b b-m"/.test(payItems(none)[0]));
  const odd = payItems(buildContractHtml({ ...F, payments: [{ amount: '10', when: 'فور التوقيع.' }, { amount: '20', when: '' }, null, 'x', { amount: '30', when: 'عند الاستلام', label: 'نهائي' }] }))
    .map(h => plain('<table class="flow">' + h));
  check('a wording that already ends in a full stop is not given a second; an empty one falls back; junk lines are skipped',
    odd.length === 3 && odd[0] === 'مبلغ قدره 10 يتم سداده فور التوقيع.' && odd[1] === 'مبلغ قدره 20 يتم سداده فور التوقيع علي هذا العقد.' && odd[2] === 'مبلغ قدره 30 يتم سداده عند الاستلام ( نهائي ).', JSON.stringify(odd));
  const twenty = Array.from({ length: 20 }, (_, i) => ({ amount: String(1000 * (i + 1)), when: 'عند الدفعة رقم ' + (i + 1) }));
  check('twenty lines: all there', payItems(buildContractHtml({ ...F, payments: twenty })).length === 20);

  // ═══ 6. The number, the letterhead ═══
  check('the contract number is in the page header, after "عقد رقم", and in the title block', /<span class="dh-ref">عقد رقم <span>MC2610-1234<\/span><\/span>/.test(filledHtml)
    && /عقد رقم <bdi class="mono">MC2610-1234<\/bdi>/.test(filledHtml));
  check('unknown, it prints nothing: no header reference, no "عقد رقم" anywhere', !/<span class="dh-ref">/.test(blankHtml) && !/عقد رقم/.test(blankText) && !/عقد رقم/.test(bodyOf(blankHtml)));
  check('the Arabic reference is not letter-spaced (it would break the joined letters)', /\.dh-ref\{[^}]*letter-spacing:0/.test(filledHtml) && !/\.title \.h-title\{[^}]*letter-spacing:-/.test(filledHtml));
  check('the letterhead carries the contract\'s own registration details, escaped, like the old contract\'s footer',
    /<b>Tax ID<\/b> 773934006/.test(filledHtml) && /<b>Registration No<\/b> 282378/.test(filledHtml) && /Heliopolis/.test(filledHtml));
  const footH = h => +(h.match(/--foot-h:([\d.]+)mm/) || [])[1];
  check('a very long address in the footer reserves the room it takes, so it can never run into the text',
    footH(filledHtml) === 26 && footH(longHtml) > 26 && footH(buildContractHtml(fx.contractUnbroken)) > 26, `${footH(filledHtml)} / ${footH(longHtml)}`);
  check('a very long unbroken value in the footer is given places to wrap', /B{24}\u200b/.test(buildContractHtml(fx.contractUnbroken)));
  check('the page counter is drawn in a font that is loaded (Cairo), so it shows in an Arabic document',
    /@page\{@bottom-left\{font-family:'Cairo'/.test(filledHtml) && /counter\(page\)/.test(filledHtml) && /صفحة/.test(filledHtml));
  check('it is an Arabic, right-to-left document with an h1 and nothing fetched from outside',
    /<html lang="ar" dir="rtl">/.test(filledHtml) && count(filledHtml, '<h1') === 1 && !/(src|href)=["']https?:/.test(filledHtml) && !/url\(["']?https?:/.test(filledHtml));
  check('the design rules are in the page: clause headings never end a page, tables and lists never split, the last clause keeps its signatures',
    /\.cl-h\{[^}]*break-after:avoid/.test(filledHtml) && /\.cl-h\{[^}]*break-inside:avoid/.test(filledHtml) && /table\.veh\{[^}]*break-inside:avoid/.test(filledHtml)
    && /\.sign\{[^}]*break-inside:avoid/.test(filledHtml) && /\.closing\{break-inside:avoid/.test(filledHtml)
    && /<div class="closing"><section class="cl"><h2 class="cl-h"><span class="cl-n">9<\/span>[\s\S]*<div class="sign">/.test(filledHtml));
  check('no overflow:hidden anywhere: a long value moves the text down, it never cuts it off', !/overflow:\s*hidden/.test(filledHtml.slice(filledHtml.indexOf('.doc{'))) );

  // ═══ 7. The server side: defaults, the auto-draft, the PDF routes ═══
  {
    const ctx = require('../src/ctx');
    const handlers = [];
    const router = {};
    for (const m of ['get', 'post', 'put', 'delete']) router[m] = (p, ...fns) => handlers.push({ method: m.toUpperCase(), path: p, fn: fns[fns.length - 1] });
    const db = { contracts: [], customers: [], deals: [], quotation_settings: [] };
    let lastHtml = '', notes = [];
    function from(table) {
      const q = { filters: [], mode: 'many', op: 'select', payload: null };
      const run = () => {
        const rows = db[table] || (db[table] = []);
        if (q.op === 'insert') { const row = { id: rows.length + 1, created_at: 'now', ...q.payload }; rows.push(row); return { data: row, error: null }; }
        const r = rows.filter(x => q.filters.every(([k, v]) => String(x[k]) === String(v)));
        if (q.mode === 'single') return r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'none' } };
        if (q.mode === 'maybe') return { data: r[0] || null, error: null };
        return { data: r, error: null };
      };
      const api = {
        select: () => api, eq: (k, v) => { q.filters.push([k, v]); return api; }, order: () => api, limit: () => api,
        insert: p => { q.op = 'insert'; q.payload = p; return api; },
        single: () => { q.mode = 'single'; return Promise.resolve(run()); },
        maybeSingle: () => { q.mode = 'maybe'; return Promise.resolve(run()); },
        then: (res, rej) => Promise.resolve(run()).then(res, rej),
      };
      return api;
    }
    Object.assign(ctx, {
      express: { json: () => (_q, _s, n) => n && n() }, logLeadActivity: () => {}, receiver: { router },
      requireAuth: () => {}, requireEmployeeAuth: () => {}, supabase: { from }, createNotification: (...a) => notes.push(a),
      renderQuotationPdf: async html => { lastHtml = html; return Buffer.from('%PDF-1.4 stub'); },
      requirePerm: () => (_q, _s, n) => n && n(), callerIdentity: () => ({ key: 'admin', name: 'Admin' }),
    });
    const mod = require('../src/routes/contracts.js');
    const route = (method, p) => handlers.find(h => h.method === method && h.path === p);
    const call = async (h, req) => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
      await h.fn({ query: {}, params: {}, body: {}, ...req }, res);
      return res;
    };
    const B = '/api/dashboard/contracts';

    db.customers.push({ id: 3, name: 'عمر حسن', address: 'القاهرة', custom_fields: { cf_national_id: '29504151234567', cf_color: 'أبيض', cf_year: '2026', cf_vehicle_offered: 'Mazda EZ60 EV Max' } });
    db.quotation_settings.push({ key: 'company_rep', value: 'محمد ياسر' });
    const d1 = (await call(route('GET', `${B}/new/defaults`), { query: { customer_id: '3' } })).body;
    check('a new contract starts on the car-sale wording: template sale-v2, one payment line with the pre-printed wording',
      d1.data.template === 'sale-v2' && d1.data.payments.length === 1 && d1.data.payments[0].when === T.DEFAULT_PAYMENT_WHEN && d1.data.payments[0].amount === '', JSON.stringify(d1.data.payments));
    check('…without the old contract\'s fields: no import country, late fee or delivery deadline',
      !['importCountry', 'lateFee', 'lateFeeWords', 'deliveryDeadline'].some(k => k in d1.data));
    check('…prefilled from the lead and the settings, the buyer as an Egyptian Muslim as the paper form has it',
      d1.data.buyer.name === 'عمر حسن' && d1.data.buyer.nationalId === '29504151234567' && d1.data.buyer.nationality === 'مصري' && d1.data.buyer.religion === 'مسلم'
      && d1.data.vehicle.make === 'Mazda' && d1.data.vehicle.model === 'EZ60 EV Max' && d1.data.rep.name === 'محمد ياسر' && d1.data.company.repIn === 'محمد ياسر' && d1.data.rep.role === 'مدير الشركة');
    check('…and carries its own number: the one the editor is given', /^MC\d{4}-\d{4}$/.test(d1.contract_no) && d1.data.contractNo === d1.contract_no, d1.contract_no);
    const printed = plain(buildContractHtml(d1.data));
    check('a freshly drafted contract prints on the new wording, with its number and the lead\'s details',
      printed.includes('عقد بيع سيارة استيراد') && printed.includes(d1.contract_no) && printed.includes('عمر حسن') && printed.includes('29504151234567') && printed.includes('مبلغ قدره يتم سداده فور التوقيع علي هذا العقد.'));

    db.contracts.length = 0;
    await mod.autoCreateContractForWonDeal({ id: 9, stage: 'won', customer_id: 3, title: 'Seal', vehicle: 'BYD Seal' });
    const auto = db.contracts[0];
    check('the auto-draft when a deal is won is a car-sale contract too, its number the same in the row and in the payload',
      auto && auto.data.template === 'sale-v2' && auto.contract_no === auto.data.contractNo && auto.status === 'draft' && auto.created_by === 'auto_won' && auto.data.vehicle.make === 'BYD', auto && auto.contract_no);
    const again = await mod.autoCreateContractForWonDeal({ id: 9, stage: 'won', customer_id: 3, title: 'Seal' });
    check('…and still only one per deal', again === null && db.contracts.length === 1);

    const { contractNo: _unused, ...SALE } = F;   // a contract whose payload does not carry its number
    let r = await call(route('POST', `${B}/pdf`), { body: { data: SALE, contract_no: 'MC2610-0042' } });
    check('the preview of an unsaved contract prints the number the editor holds', r.body && r.body.pdf && /<span class="dh-ref">عقد رقم <span>MC2610-0042<\/span>/.test(lastHtml), String(r.code));
    r = await call(route('POST', `${B}/pdf`), { body: { data: { ...SALE, contractNo: 'MC2610-0043' } } });
    check('…or the one in its payload', /MC2610-0043/.test(lastHtml));
    r = await call(route('POST', `${B}/pdf`), { body: { data: SALE } });
    check('…and with no number at all, none is printed', r.body.pdf && !/<span class="dh-ref">/.test(lastHtml));
    r = await call(route('POST', `${B}/pdf`), { body: { data: fx.contractLegacy, contract_no: 'MC2501-7' } });
    check('a preview of an old contract is still the old wording', /عقد شراء وإستيراد سيارة لحساب الغير/.test(lastHtml) && !/MC2501-7/.test(lastHtml));
    r = await call(route('POST', `${B}/pdf`), { body: { data: 'not an object' } });
    check('a preview with a payload that is not an object does not crash', r.code === 200 && /عقد شراء وإستيراد/.test(lastHtml));

    db.contracts.push({ id: 51, contract_no: 'MC2610-0099', data: { ...SALE, contractNo: 'STALE-1' } }, { id: 52, contract_no: 'MC2501-0001', data: fx.contractLegacy }, { id: 53, contract_no: 'MC2610-0100', data: null });
    r = await call(route('POST', `${B}/:id/pdf`), { params: { id: '51' } });
    check('a saved contract prints the number of its row, whatever its payload says', r.body.name === 'MC2610-0099' && /MC2610-0099/.test(lastHtml) && !/STALE-1/.test(lastHtml));
    r = await call(route('POST', `${B}/:id/pdf`), { params: { id: '52' } });
    check('a saved OLD contract re-exports with the words it was signed on',
      /عقد شراء وإستيراد سيارة لحساب الغير/.test(lastHtml) && /عشرة بنود/.test(lastHtml) && sha(lastHtml) === sha(buildLegacyContractHtml(fx.contractLegacy)));
    r = await call(route('POST', `${B}/:id/pdf`), { params: { id: '53' } });
    check('…and one with no data does not crash', r.code === 200 && r.body.pdf);
    r = await call(route('POST', `${B}/:id/pdf`), { params: { id: '404' } });
    check('…an unknown one is a 404', r.code === 404);

    r = await call(route('POST', B), { body: { contract_no: 'MC2610-0200', title: 't', data: { template: 'sale-v2', buyer: { name: 'x' }, contractNo: 'WRONG' } } });
    const saved = db.contracts[db.contracts.length - 1];
    check('saving a car-sale contract: the number in its payload is made its own', saved.contract_no === 'MC2610-0200' && saved.data.contractNo === 'MC2610-0200' && saved.data.template === 'sale-v2');
    r = await call(route('POST', B), { body: { title: 't', data: { template: 'sale-v2' } } });
    const saved2 = db.contracts[db.contracts.length - 1];
    check('…also when the client sent no number: the one the server mints', /^MC\d{4}-\d{4}$/.test(saved2.contract_no) && saved2.data.contractNo === saved2.contract_no);
    r = await call(route('POST', B), { body: { contract_no: 'MC2610-0201', title: 't', data: { buyer: { name: 'old' } } } });
    const saved3 = db.contracts[db.contracts.length - 1];
    check('…and an old-wording contract is saved exactly as sent', saved3.data.template === undefined && !('contractNo' in saved3.data) && JSON.stringify(saved3.data) === '{"buyer":{"name":"old"}}');

    const FOLDER = fs.readFileSync('src/routes/client-folder.js', 'utf8');
    check('the client folder files the contract with its number, like the PDF routes',
      /html: async r => ctx\.buildContractHtml\(\{ \.\.\.\(r\.data \|\| \{\}\), contractNo: r\.contract_no \}\)/.test(FOLDER));
    const CTR = fs.readFileSync('src/routes/contracts.js', 'utf8');
    check('the contract routes use the shared builder and not the retired global logo',
      /require\('\.\.\/lib\/docs\/contract'\)/.test(CTR) && !/BRAND_LOGO_URL/.test(CTR) && !/buildLegacyContractHtml/.test(CTR));
  }

  // ═══ 8. In a browser: nothing overflows, nothing is lost ═══
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const open = async (html) => {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123 });
      await page.setRequestInterception(true);
      page.on('request', r => (/^(data:|about:)/.test(r.url()) ? r.continue() : r.abort()));
      await page.emulateMediaType('print');
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      return page;
    };
    // The text column of an A4 page is 182 mm = 688 px. A value that cannot wrap makes the whole table wider
    // than that (the column stretches to hold it), so the column's own width is part of the check, and so is
    // every box and every piece of text inside it.
    const overflow = page => page.evaluate(() => {
      const doc = document.querySelector('.doc').getBoundingClientRect();
      const bad = [];
      for (const el of document.querySelectorAll('.doc *')) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.right > doc.right + 1 || r.left < doc.left - 1) bad.push(el.tagName + '.' + el.className + ' ' + Math.round(r.left - doc.left) + '..' + Math.round(r.right - doc.left));
      }
      const walker = document.createTreeWalker(document.querySelector('.doc'), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.right > doc.right + 1 || r.left < doc.left - 1) { bad.push('text "' + n.textContent.trim().slice(0, 14) + '" ' + Math.round(r.left - doc.left) + '..' + Math.round(r.right - doc.left)); break; }
      }
      return { bad: bad.slice(0, 5), n: bad.length, width: Math.round(doc.width) };
    });
    for (const name of ['contract', 'contractBlank', 'contractLong', 'contractUnbroken', 'contractMixed', 'contractHostile']) {
      const page = await open(buildContractHtml(fx[name]));
      const o = await overflow(page);
      check(`${name}: the text column is the page's (${o.width}px of 688) and nothing runs outside it`, o.n === 0 && o.width <= 690, `${o.width}px ${o.bad.join(' | ')}`);
      const head = await page.evaluate(() => { const h = document.querySelector('.doc-header'); const r = h.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), over: h.scrollWidth - h.clientWidth }; });
      check(`${name}: the page header stays inside the page`, head.over <= 1 && head.left >= 0 && head.right <= 795, JSON.stringify(head));
      if (name === 'contractHostile') {
        const dom = await page.evaluate(() => ({ imgs: document.querySelectorAll('.doc img').length, h1: document.querySelectorAll('h1').length, h: document.querySelectorAll('.doc h1,.doc h2').length,
          scripts: document.querySelectorAll('script').length, text: document.querySelectorAll('.party')[1].textContent }));
        check('hostile: in a real DOM there is no <img>, no extra heading, no script — the markup is text', dom.imgs === 0 && dom.h1 === 1 && dom.scripts === 0 && /<img src=x onerror=alert\(1\)>/.test(dom.text), JSON.stringify(dom).slice(0, 120));
      }
      if (name === 'contractMixed') {
        const bidi = await page.evaluate(() => {
          const vs = [...document.querySelectorAll('.doc .v')];
          return { n: vs.length, isolated: vs.every(v => getComputedStyle(v).unicodeBidi === 'isolate'),
            dirs: Object.fromEntries([...document.querySelectorAll('.doc .v')].slice(0, 40).map(v => [v.textContent, v.matches(':dir(ltr)') ? 'ltr' : 'rtl'])) };
        });
        check('mixed Arabic/Latin/digits: every value is an isolate, and each takes its own direction from its own first letter',
          bidi.n > 30 && bidi.isolated && bidi.dirs['Ahmed Kamal أحمد كمال'] === 'ltr' && bidi.dirs['أبيض لؤلؤي (Pearl White)'] === 'rtl'
          && bidi.dirs['٢٩٠٠١٠١١٢٣٤٥٦٧'] === 'ltr' && bidi.dirs['12 شارع النصر - Block 7B - Nasr City (مدينة نصر)'] === 'rtl', JSON.stringify(bidi.dirs).slice(0, 160));
        const t = plain(buildContractHtml(fx.contractMixed));
        check('…and prints them as typed',
          ['Mohamed Yasser محمد ياسر', '٢٩٠٠١٠١١٢٣٤٥٦٧', '15 مارس 2022', 'Seal 2025 AWD 82.5 kWh', 'Tel: +20 100 123 4567 - طلب خاص #12 (شاحن 22kW)', '2,450,000.50', 'مبلغ قدره 1450000.50 يتم سداده عند استلام السيارة (Delivery) في موعد أقصاه 30/11/2026 ( الدفعة الأخيرة ).'].every(s => t.includes(s)));
      }
      await page.close();
    }
  } finally { await browser.close(); }

  // ═══ 9. In a real PDF ═══
  const pdftotext = have('pdftotext');
  const stress = { ...fx.contractLong, payments: Array.from({ length: 14 }, (_, i) => ({ amount: String(100000 * (i + 1)), when: 'عند الدفعة رقم ' + (i + 1) + ' من الدفعات المتفق عليها بين الطرفين' })),
    vehicle: { ...fx.contractLong.vehicle, notes: 'ملاحظة '.repeat(120) } };
  // The contract again with 1…7 more payment lines: each one moves everything below it down by a line's height,
  // so somewhere in the sweep the last clause lands where it fits on a page and the signatures do not.
  const sweep = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`sweep+${i + 1}`,
    { ...fx.contract, payments: [...fx.contract.payments, ...Array.from({ length: i + 1 }, (_, j) => ({ amount: String(50000 * (j + 1)), when: 'عند الدفعة رقم ' + (j + 2) }))] }]));
  // A note so long that the vehicle table cannot fit where it is: it must move whole to the next page, not split.
  const tableStress = { ...fx.contract, vehicle: { ...fx.contract.vehicle, notes: 'ملاحظة '.repeat(200) } };
  const toRender = { contract: fx.contract, contractLong: fx.contractLong, contractBlank: fx.contractBlank, stress, tableStress, ...sweep };
  // Each render starts its own Chrome: a few at a time, so a busy machine does not time one out.
  const pdfs = {};
  const queue = Object.entries(toRender);
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) pdfs[job[0]] = Buffer.from(await renderPdf(buildContractHtml(job[1])));
  }));
  const pagesOf = b => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const pageTexts = (b, n) => {
    const f = path.join(os.tmpdir(), `doc-contract-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(f, b);
    try { return Array.from({ length: n }, (_, i) => spawnSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), '-layout', f, '-'], { encoding: 'utf8' }).stdout || ''); }
    finally { fs.unlinkSync(f); }
  };
  check('a contract is a real A4 PDF with the Cairo face embedded', Object.values(pdfs).every(b => b.slice(0, 5).toString() === '%PDF-' && /Cairo/.test(b.toString('latin1')) && /\/MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*\s*\]/.test(b.toString('latin1'))));
  const nPages = Object.fromEntries(Object.entries(pdfs).map(([k, b]) => [k, pagesOf(b)]));
  check('it flows onto the pages it needs: the contract and the blank form take 3 to 5, the long ones a few more at most',
    nPages.contract >= 3 && nPages.contract <= 5 && nPages.contractBlank >= 3 && nPages.contractBlank <= 5 && nPages.contractLong >= 3 && nPages.contractLong <= 6 && nPages.stress >= 4 && nPages.stress <= 9 && nPages.tableStress >= 4 && nPages.tableStress <= 6
    && Object.keys(sweep).every(k => nPages[k] >= 3 && nPages[k] <= 6), JSON.stringify(nPages));
  if (!pdftotext) console.log('  (pdftotext is not installed: the page-by-page checks of the PDFs are skipped)');
  else {
    const FOOT = /Office|info@motolinkers|www\.motolinkers|Tax ID|Registration|Confidential|صفحة|AUTOMOTIVE|MOBILITY|ELECTRIC|عقد رقم/;
    const bodyLines = t => t.split('\n').filter(l => l.trim() && !FOOT.test(l));
    for (const [name, pdf] of Object.entries(pdfs)) {
      const n = nPages[name];
      const pages = pageTexts(pdf, n);
      const last = pages[n - 1];
      // the signing row is the one line that holds the label "التوقيع" twice, once for each box
      const sigPages = pages.map((t, i) => (t.split('\n').some(l => (l.match(/التوقيع/g) || []).length >= 2) ? i + 1 : 0)).filter(Boolean);
      check(`${name}: the signature boxes and the last clause are together on the last page`,
        sigPages.join() === String(n) && (last.match(/الرقم القومي/g) || []).length === 2 && /الطرف الثاني/.test(last)
        && /تسعة بنود/.test(last) && /البند التاسع/.test(last), `signatures on page(s) ${sigPages.join(',')} of ${n}`);
      if (name === 'contract' || name === 'contractLong') check(`${name}: the signing boxes carry the two national IDs`, /29001011234567/.test(last) && /29504151234567/.test(last));
      const stranded = pages.map((t, i) => {
        const ls = bodyLines(t); const lastLine = ls[ls.length - 1] || '';
        // a heading is its number and its words; torn apart, the number alone is left at the foot of the page
        return /^\s*(?:\d\s+)?(?:البند\s+\S+|تمهيد)(?:\s+\d)?\s*$|^\s*\d\s*$/.test(lastLine) ? `${i + 1}: ${lastLine.trim()}` : '';
      }).filter(Boolean);
      check(`${name}: no page ends on a clause heading`, stranded.length === 0, stranded.join(' | '));
      const firstOnPage = pages.slice(1).map((t, i) => (bodyLines(t)[0] || '').trim()).filter(l => /^(?:\d\s+)?(?:اﻷ|األ)?التوقيع|^الاسم/.test(l));
      check(`${name}: no page after the first opens with a stray signature row`, firstOnPage.length === 0, firstOnPage.join(' | '));
      const pageOf = re => pages.findIndex(t => re.test(t)) + 1;
      check(`${name}: the vehicle table is whole on one page, and so is the payment list`,
        new Set([/ماركة السيارة/, /موديل السيارة/, /اللون/, /سنة الصنع/].map(pageOf)).size === 1 && pageOf(/ماركة السيارة/) > 0
        && pages.filter(t => /مبلغ قدره/.test(t)).length === 1, `${[/ماركة السيارة/, /موديل السيارة/, /اللون/, /سنة الصنع/].map(pageOf).join(',')} / ${pages.map(t => (t.match(/مبلغ قدره/g) || []).length).join(',')}`);
      if (/ملاحظة/.test((toRender[name].vehicle || {}).notes || '')) {
        const notePages = pages.map((t, i) => (/م(?:لا|ال)حظة/.test(t) ? i + 1 : 0)).filter(Boolean);
        check(`${name}: a long note stays inside its table, and the table is not torn across two pages`, notePages.length === 1 && notePages[0] === pageOf(/ماركة السيارة/), notePages.join(','));
      }
      check(`${name}: "…على النحو التالي :" is on the page of its vehicle table, "…والنقل :" on the page of its first payment line`,
        pageOf(/النحو/) === pageOf(/ماركة السيارة/) && pageOf(/أجور الشحن والنقل/) === pageOf(/مبلغ قدره/) && pageOf(/النحو/) > 0 && pageOf(/مبلغ قدره/) > 0,
        `${pageOf(/النحو/)}/${pageOf(/ماركة السيارة/)} ${pageOf(/أجور الشحن والنقل/)}/${pageOf(/مبلغ قدره/)}`);
      check(`${name}: every page carries the letterhead and its page number`, pages.every((t, i) => /info@motolinkers\.com/.test(t) && /صفحة/.test(t) && new RegExp(`\\b${i + 1}\\b`).test(t) && /Confidential/.test(t)));
      if (name !== 'contractBlank') check(`${name}: the contract number is on every page`, pages.every(t => /MC2610-1234|MC2610-0007/.test(t)));
      else check(`${name}: with no number known there is none on any page`, pages.every(t => !/MC2\d{3}/.test(t)));
    }
    const filledPages = pageTexts(pdfs.contract, nPages.contract);
    check('the filled contract has its vehicle table and its payment line on a page, and the table is whole on one page',
      filledPages.filter(t => /ماركة السيارة/.test(t) && /موديل السيارة/.test(t) && /سنة الصنع/.test(t) && /EZ60 EV 600 Max/.test(t)).length === 1 && filledPages.some(t => /1,340,535/.test(t)));
    const stressPages = pageTexts(pdfs.stress, nPages.stress);
    check('fourteen payment lines and a long note: still paginates, every amount printed once, the signatures intact',
      Array.from({ length: 14 }, (_, i) => (100000 * (i + 1)).toLocaleString('en-US')).every(a => stressPages.join('\n').split(a).length - 1 >= 1)
      && stressPages[nPages.stress - 1].includes('التوقيع'));
  }
} )().catch(e => { console.error(e); results.push(false); }).then(async () => {
  // ═══ 10. The editor shows the right fields for each template (the real procurement.js, in the real dashboard) ═══
  try { await editorChecks(); } catch (e) { console.error(e); results.push(false); }
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});

async function editorChecks() {
  const SALE = { template: 'sale-v2', contractNo: 'MC2610-1234', contractDate: { day: 'الأحد', d: '12', m: '10', y: '2026' },
    company: { name: 'MotoLinkers', commercialReg: '282378', taxId: '773934006', address: 'Cairo', repIn: 'محمد ياسر' },
    rep: { name: 'محمد ياسر', nationality: 'مصري', role: 'مدير الشركة' }, buyer: { name: 'عمر', nationality: 'مصري', religion: 'مسلم' },
    vehicle: { make: 'مازدا' }, total: '100', totalWords: '', importCountry: 'الصين', lateFee: '5',
    payments: [{ amount: '60', when: 'فور التوقيع علي هذا العقد', label: 'x' }, { amount: '40', when: 'عند الاستلام', label: '' }] };
  const LEGACY = { contractDate: {}, company: {}, rep: {}, buyer: { name: 'Old' }, vehicle: {}, importCountry: 'الصين', lateFee: '500', lateFeeWords: 'x', deliveryDeadline: '45',
    payments: [{ amount: '1', when: 'فور التوقيع علي هذا العقد', label: '' }, { amount: '2', when: 'عند استلام السيارة', label: 'ش' }] };
  let defaults = SALE;
  const writes = [];
  const api = (p, method, body) => {
    if (method === 'POST' && /contracts$/.test(p)) { writes.push({ p, body: JSON.parse(body || '{}') }); return { ok: true, id: 5, contract_no: 'MC2610-1234' }; }
    if (method === 'POST' && /contracts\/pdf$/.test(p)) { writes.push({ p, body: JSON.parse(body || '{}') }); return { pdf: 'JVBERi0xLjQK' }; }
    if (/contracts\/new\/defaults$/.test(p)) return { contract_no: 'MC2610-1234', data: defaults };
    if (/contracts\/7$/.test(p)) return { id: 7, contract_no: 'MC2501-1', data: LEGACY, status: 'draft' };
    if (/columns\/contracts$/.test(p)) return { columns: [] };
    if (/auth\/check$/.test(p)) return { ok: true };
    return [];
  };
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (u.pathname.startsWith('/api/')) {
        if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
      }
      if (u.pathname === '/dashboard') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/dashboard.html', 'utf8') });
      const f = path.join('public', u.pathname.replace(/^\//, ''));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        return req.respond({ status: 200, ...(f.endsWith('.js') ? { contentType: 'application/javascript' } : f.endsWith('.css') ? { contentType: 'text/css' } : {}), body: fs.readFileSync(f) });
      }
      req.respond({ status: 404, body: '' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ml_admin_token', 't'));
    await page.goto(`http://127.0.0.1:${port}/dashboard`, { waitUntil: 'networkidle2' });
    await sleep(400);
    await page.evaluate(() => navigate('contracts'));
    await sleep(300);

    const form = () => page.evaluate(() => ({
      paths: [...document.querySelectorAll('.ct-f')].map(i => i.dataset.path),
      pay: [...document.querySelectorAll('#ct-pay-list .ct-pay')].map(r => [r.querySelector('[data-pay=amount]').value, r.querySelector('[data-pay=when]').value, r.dataset.label]),
      add: !!document.getElementById('ct-pay-add'),
      text: document.getElementById('modal-body') ? document.getElementById('modal-body').textContent : '',
    }));
    const collect = () => page.evaluate(() => { const d = ctCollect(); return { template: d.template, contractNo: d.contractNo, payments: d.payments, importCountry: d.importCountry, lateFee: d.lateFee, buyer: d.buyer && d.buyer.name }; });
    const LEGACY_ONLY = ['importCountry', 'lateFee', 'lateFeeWords', 'deliveryDeadline'];

    await page.evaluate(async () => { await openContractForm(null); await new Promise(r => setTimeout(r, 300)); });
    let f = await form();
    check('editor, new contract (sale-v2): the old contract\'s fields are not offered — import country, late fee, delivery deadline',
      LEGACY_ONLY.every(k => !f.paths.includes(k)) && !/Import country|Late fee|Delivery deadline/.test(f.text), f.paths.filter(p => LEGACY_ONLY.includes(p)).join());
    check('…the parties, the vehicle, the total and its words are', ['contractDate.d', 'company.name', 'company.repIn', 'rep.role', 'buyer.nationality', 'buyer.religion', 'buyer.idDate', 'vehicle.notes', 'total', 'totalWords'].every(k => f.paths.includes(k)));
    check('…and the payment lines are editable: amount and wording, with the lines the contract has',
      f.add && f.pay.length === 2 && f.pay[0][0] === '60' && f.pay[0][1] === 'فور التوقيع علي هذا العقد' && f.pay[1][1] === 'عند الاستلام', JSON.stringify(f.pay));
    await page.click('#ct-pay-add');
    f = await form();
    check('"Add payment line" adds a line whose wording is the default "فور التوقيع علي هذا العقد"', f.pay.length === 3 && f.pay[2][1] === 'فور التوقيع علي هذا العقد' && f.pay[2][0] === '', JSON.stringify(f.pay[2]));
    // remove the middle line, fill the new one: the first line keeps the label it came with
    await page.evaluate(() => { const rows = document.querySelectorAll('#ct-pay-list .ct-pay'); rows[2].querySelector('[data-pay=amount]').value = ' 7 '; rows[1].querySelector('.ct-pay-del').click(); });
    f = await form();
    check('a line can be removed (from the middle)', f.pay.length === 2 && f.pay[0][0] === '60' && f.pay[1][0] === ' 7 ', JSON.stringify(f.pay));
    let c = await collect();
    check('what is collected is exactly the lines on screen (trimmed); a label travels with its own line; the template and the number are kept',
      JSON.stringify(c.payments) === JSON.stringify([{ amount: '60', when: 'فور التوقيع علي هذا العقد', label: 'x' }, { amount: '7', when: 'فور التوقيع علي هذا العقد', label: '' }])
      && c.template === 'sale-v2' && c.contractNo === 'MC2610-1234', JSON.stringify(c));
    await page.evaluate(() => { document.querySelector('#ct-pay-list .ct-pay .ct-pay-del').click(); });
    c = await collect();
    check('…and removing the labelled line takes its label with it: it does not slide onto the next line',
      JSON.stringify(c.payments) === JSON.stringify([{ amount: '7', when: 'فور التوقيع علي هذا العقد', label: '' }]), JSON.stringify(c.payments));
    await page.evaluate(() => { document.querySelectorAll('#ct-pay-list .ct-pay-del').forEach(b => b.click()); });
    c = await collect();
    check('every line removed → no payments (the PDF then prints the one blank line of the paper form)', Array.isArray(c.payments) && c.payments.length === 0);
    await page.click('#ct-pay-add');
    await page.evaluate(() => { document.querySelector('[data-pay=amount]').value = '1500000'; });
    writes.length = 0;
    await page.evaluate(async () => { await saveContract(true); });
    await waitFor(() => writes.some(w => /contracts\/pdf$/.test(w.p)));
    const save = writes.find(w => /contracts$/.test(w.p)), prev = writes.find(w => /contracts\/pdf$/.test(w.p));
    check('saving posts the car-sale payload: template, number, the payment line',
      save && save.body.contract_no === 'MC2610-1234' && save.body.data.template === 'sale-v2' && save.body.data.contractNo === 'MC2610-1234'
      && JSON.stringify(save.body.data.payments) === JSON.stringify([{ amount: '1500000', when: 'فور التوقيع علي هذا العقد', label: '' }]), JSON.stringify(save && save.body.data.payments));
    check('…and "Save & preview" renders what was collected, number included', prev && prev.body.data.contractNo === 'MC2610-1234' && prev.body.data.template === 'sale-v2');
    await page.evaluate(() => { try { hideModal(); } catch (_) {} const m = document.getElementById('ct-modal'); if (m) m.style.display = 'none'; });

    defaults = LEGACY;
    await page.evaluate(async () => { await openContractForm(7); await new Promise(r => setTimeout(r, 300)); });
    f = await form();
    check('editor, a contract on the old wording: its own fields are all there (import country, late fee and its words, delivery deadline)',
      LEGACY_ONLY.every(k => f.paths.includes(k)) && /Import country/.test(f.text) && /Late fee/.test(f.text) && /Delivery deadline/.test(f.text));
    check('…and its payment schedule is the old read-only one: amounts only, no add or remove',
      !f.add && f.pay.length === 0 && f.paths.includes('payments.0.amount') && f.paths.includes('payments.1.amount') && /عند استلام السيارة/.test(f.text) && /\(ش\)/.test(f.text));
    c = await collect();
    check('…and collecting it changes nothing about it: no template added, no number added, the schedule as it was',
      c.template === undefined && c.contractNo === undefined && c.importCountry === 'الصين' && c.lateFee === '500' && c.payments.length === 2 && c.payments[1].label === 'ش');
    defaults = {};
    await page.evaluate(() => { try { hideModal(); } catch (_) {} });
    await page.evaluate(async () => { await openContractForm(null); await new Promise(r => setTimeout(r, 300)); });
    f = await form();
    c = await collect();
    check('a new contract whose defaults carry no template at all (an old server) is edited as an old-wording contract, and saved as one',
      LEGACY_ONLY.every(k => f.paths.includes(k)) && !f.add && c.template === undefined && c.contractNo === undefined);
    check('the editor ran without a page error', errs.length === 0, errs.slice(0, 2).join(' | '));
  } finally { await browser.close(); srv.close(); }
}
