'use strict';
// عقد بيع سيارة استيراد — the wording of the car-sale (import) contract.
//
// This is the text of the PDF the company uploaded, transcribed from the page images
// (the machine extraction of that PDF garbles the lam-alef ligature and scrambles one
// phrase, so it was only a typing aid). It is kept VERBATIM, oddities and all — the
// typos of the source are the company's to correct, not a layout module's. Where the
// source has a typo that a reader would trip on it is listed in the owner notes that
// come with this change, not fixed here.
//
// Plain constants, no layout: ./contract.js decides how this looks. A `{name}` in a
// string is a BLANK of the paper form: it is filled from the contract's data, or
// printed as a dotted line to be completed by hand. The names are:
//
//   {day} {d} {m} {y}                 contractDate
//   {co.name} {co.commercialReg} {co.taxId} {co.address} {co.repIn}
//   {rep.name} {rep.nationalId} {rep.idDate} {rep.nationality} {rep.religion} {rep.address} {rep.role}
//   {buyer.name} {buyer.nationalId} {buyer.idDate} {buyer.nationality} {buyer.religion} {buyer.address}
//   {total} {totalWords}              the price, in figures and in words
//   {amount} {when}                   one payment line
//
// What the layout changes on purpose and nothing else: the tatweel (kashida) that the
// source uses to stretch "البنـد" and "الســيد" is left out, a blank's trailing "/" is
// part of the blank, spaces inside brackets are made regular, and the colon after a
// label in a label/value table or a signature box is the layout's, not the text's.

const TITLE = 'عقد بيع سيارة استيراد';

// ── The date line and the parties ─────────────────────────────────────────────
const DATE_LINE = 'إنه في يوم {day} الموافق {d} / {m} / {y} ، حرر بين كلا من -:';

const FIRST_PARTY = {
  lead: 'أولا -:',
  company: 'شركة / {co.name} ، ( ش . . ) ، سجل تجاري رقم {co.commercialReg} ، بطاقة ضريبية رقم : {co.taxId} ، ومقرها {co.address} ويمثلها في هذا العقد {co.repIn}',
  person: 'السيد / {rep.name} ، ويحمل بطاقة رقم قومي {rep.nationalId} صادرة بتاريخ {rep.idDate} ، {rep.nationality} الجنسية ، {rep.religion} الديانة ، ومقيم: {rep.address} ، وذلك بصفه {rep.role} عن الشركة بموجب تفويض خاص بذلك .',
  ref: '( ويشار إليه في هذا العقد بالطرف الأول – المستورد – صاحب الترخيص - البائع )',
};

const SECOND_PARTY = {
  lead: 'ثانيا :',
  person: 'السيد / {buyer.name} ، ويحمل بطاقة رقم قومي {buyer.nationalId} صادرة بتاريخ {buyer.idDate} ، {buyer.nationality} الجنسية ، {buyer.religion} الديانة ، ومقيم: {buyer.address}',
  ref: '( ويشار إليه في هذا العقد بالطرف الثاني – المشتري )',
};

const ACCEPT = 'أقر المتعاقدان علي أهليتهما للتصرف وأتفقا علي ما يأتي :';

// ── تمهيد ────────────────────────────────────────────────────────────────────
const PREAMBLE = {
  heading: 'تمهيد',
  text: 'حيث أن الطرف الأول هي شركة منشأة طبقا لقوانين جمهورية مصر لعربية ، ومتخصصة ومرخص لها بإستيراد وتجارة السيارات من الخارج لداخل مصر ، ولما كان الطرف الثاني يرغب في شراء سيارة إستيراد طبقا للمواصفات الموضحة بالبند الثاني من هذا العقد من خارج جمهورية مصر العربية عن طريق الطرف الأول ، علي أن يتم الإستيراد تحت مسئولية الطرف الأول ولحساب الطرف الثاني ، مع استيفاء كافة النواحي القانونية لتملك الطرف الثاني السيارة مقابل حصول الطرف الأول علي المقابل المذكور بالبند الثالث من هذا العقد ، وبعد أن أقر الطرف الأول بصحة الأوراق ، وتلاقت إرادة الطرفين بعد أن أقرا بأهليتهما الكاملة للتعاقد ، وإتفقا علي ما يلي :',
};

// ── The vehicle table (البند الثاني) ───────────────────────────────────────────
// label → the key of data.vehicle it is filled from
const VEHICLE_ROWS = [
  ['ماركة السيارة', 'make'],
  ['موديل السيارة', 'model'],
  ['اللون', 'color'],
  ['سنة الصنع', 'year'],
  ['ملاحظات', 'notes'],
];

// ── The payment line (البند الثالث) ────────────────────────────────────────────
// "يتم سداده فور التوقيع علي هذا العقد" is pre-printed in the paper form: a payment line
// that names no other occasion says this.
const DEFAULT_PAYMENT_WHEN = 'فور التوقيع علي هذا العقد';
const PAYMENT_LINE = 'مبلغ قدره {amount} يتم سداده {when}';

// ── The nine clauses ──────────────────────────────────────────────────────────
// Each clause is a list of blocks, in reading order:
//   { t: 'p', text, lead? }      a paragraph; `lead` is the part the source prints in bold
//   { t: 'vehicle' }              the vehicle table (rows: VEHICLE_ROWS)
//   { t: 'payments' }             the list of payment lines (PAYMENT_LINE, one per payment)
//   { t: 'sub', text }            a sub-heading
//   { t: 'ol', items: [{ text, strong? }] }   a numbered list; `strong` = bold in the source
const CLAUSES = [
  { heading: 'البند الأول', blocks: [
    { t: 'p', text: 'يعتبر التمهيد الوارد بهذا العقد ، وكذا كافة المستندات الخاصة بالشركة الطرف الأول ، وكذا بصفة أطراف هذا العقد في التوقيع عليه ، وكافة المستندات الخاصة بعملية إستيراد وشراء وبيع وترخيص السيارة موضوع هذا العقد جزءاً لا يتجزأ من هذا العقد ومكملا ومتمما لبنوده ، ويقر الطرفان بان هذا العقد يعد عقد وكاله بالعمولة لاستيراد سيارة لحساب الطرف الثاني وفقا لاحكام قانون التجارة المصري والقانون المدني , ويقتصر دور الطرف الاول علي القيام باجراءات التعاقد مع الموردين والشحن والتخليص الجمركي .' },
  ] },

  { heading: 'البند الثاني', blocks: [
    { t: 'p', text: 'إتفق طرفي هذا العقد علي أن يقوم الطرف الأول بما له من خبرة وإمكانية في بيع سيارة إستيراد الأتي بيانها لحساب الطرف الثاني طبقا للمواصفات الموضحة فيما بعد ، وذلك علي النحو التالي :' },
    { t: 'vehicle' },
    { t: 'p', text: 'ويقر الطرف الثاني أنه قد عاين تفاصيل ومواصفات السيارة السالف بيانها المعاينه النافية للجهالة ، كما يقر الطرف الثاني بأن تلك التفاصيل تعد غير قابلة لآية تعديلات .' },
  ] },

  { heading: 'البند الثالث', blocks: [
    { t: 'p',
      lead: 'إتفق طرفا هذا العقد علي أن يلتزم الطرف الثاني بأن يسدد للطرف الأول نظير قيام الأخير بعملية شراء السيارة',
      text: 'داخل مصر مبلغاً قدره {total} ( فقط {totalWords} لا غير ) بالجنيه المصري وهذا المبلغ يشمل ثمن شراء وإستيراد السيارة وعمولة الطرف الأول بالإضافة إلي كافة الرسوم والضرائب والجمارك في دولة المورد أو داخل مصر، وكذلك أجور الشحن والنقل :' },
    { t: 'payments' },
  ] },

  { heading: 'البند الرابع', blocks: [
    { t: 'p', text: 'إتفق الطرفان علي أن يتم تنفيذ العقد واستلام السيارة وتسليمها للطرف الثاني بعد وصول التحويل البنكي او صرف مبلغ الشيك في حالة عدم الدفع نقدا' },
  ] },

  { heading: 'البند الخامس', blocks: [
    { t: 'sub', text: 'يلتزم الطرف الأول بالأتي:' },
    { t: 'ol', items: [
      { text: 'بتسليم الطرف الثاني السيارة واستيفاء الأوراق اللازمة بالجمرك لتسجيلها ونقل ملكيتها باسم الطرف الثاني والمحافظة عليها وقت تسليمها.' },
      { text: 'يقر الطرف الأول بصحة جميع الأوراق الخاصة بالسيارة ومطابقتها للشروط والمواصفات المتفق عليها الواردة بكتالوج السيارة.' },
      { text: 'يقرالطرف الأول بإلتزامه بتسليم السيارة للطرف الثاني دون وجود أي عيوب ظاهرة او غير ظاهرة بالسيارة وخاصة تغيير هيكل السيارة أو وجود بارومة أو أجراء تعديل على الماتور أو الشاسية أو تغيير الفتيس أو تعديله.' },
    ] },
    { t: 'sub', text: 'يلتزم الطرف الثاني بالأتي :' },
    { t: 'ol', items: [
      { text: 'بسداد المبلغ المذكور بالبند الثالث من هذا العقد طبقا للقيم والدفعات والمواعيد المتفق عليها في هذا العقد.' },
      { text: 'بإستلام السيارة خلال أسبوع من الموعد المتفق عليه بالبند الرابع من هذا العقد عقب إخطاره من الطرف الأول رسميا بذلك.' },
      { strong: true, text: 'يلتزم الطرف الثاني بأن يتسلم السيارة بشخصه أو من ينوب عنه بموجب توكيل رسمي بذلك .ولا يتم التعامل بأي تفويضات أو غير ذلك من المستندات .' },
    ] },
  ] },

  { heading: 'البند السادس', blocks: [
    { t: 'p', text: 'في حال تراجع الطرف الثاني عن إتمام تنفيذ هذا العقد عقب توقيعه وقبل استلام السيارة محل هذا التعاقد ، فإنه يلزم بأن يدفع للطرف الأول مبلغا وقدره 10% من قيمه السيارة المدونة اعلاه' },
  ] },

  { heading: 'البند السابع', blocks: [
    { t: 'p', text: 'كل نزاع ينشأ بين الطرفين خاصا بتنفيذ أي شرط من شروط هذا العقد يكون الفصل فيه من اختصاص محكمة شمال القاهرة الإبتدائية وجزئياتها ويقر الطرفان بأن عنوانيهما الموضح بأول هذا العقد هو محل إقامتهما وأية مراسلات أو إعلانات عليه تكون صحيحة ومنتجة قانونا وفي حالة تغير أي من الطرفين محل إقامته يلتزم بإخطار الطرف الآخر بموجب إنذار علي يد محضر أو بخطاب موصي عليه بعلم الوصول .' },
  ] },

  { heading: 'البند الثامن', blocks: [
    { t: 'p', text: 'يخضع هذا العقد ويتم تفسيره طبقًا لقوانين جمهورية مصر العربية ، ويمثل هذا العقد كامل الاتفاقات ما بين الطرفين ، ويحل محل أي اتفاق آخر أو تفاهم بينهما في هذا الخصوص سواء بالكتابة أو شفويًا ، ولا يجوز تعديل أي بند من بنود هذا العقد إلا بطربق الكتابة وتوقيع أطرافه الموضحين بأول هذا العقد .' },
  ] },

  { heading: 'البند التاسع', blocks: [
    { t: 'p', text: 'تحرر هذا العقد من تسعة بنود يقر كل من الطرفين بعلمه بكل ما جاء بها من شروط وأحكام ولا يجوز الرجوع فيها بعد توقيعه علي العقد وتحرر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها.' },
  ] },
];

// ── The signature block ───────────────────────────────────────────────────────
// Party 1 signs as the company's representative (rep.name / rep.nationalId), party 2 as
// the buyer. Labels are the source's, without the colon the layout draws itself.
const SIGNATURE = {
  first:  { title: 'الطرف الأول',  name: '{rep.name}',   nationalId: '{rep.nationalId}' },
  second: { title: 'الطرف الثاني', name: '{buyer.name}', nationalId: '{buyer.nationalId}' },
  labels: { name: 'الاسم', nationalId: 'الرقم القومي', signature: 'التوقيع' },
};

module.exports = {
  TITLE, DATE_LINE, FIRST_PARTY, SECOND_PARTY, ACCEPT, PREAMBLE,
  VEHICLE_ROWS, DEFAULT_PAYMENT_WHEN, PAYMENT_LINE, CLAUSES, SIGNATURE,
};
