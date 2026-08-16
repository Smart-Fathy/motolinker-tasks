// Contracts (Arabic
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { escHtml, express, logLeadActivity, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('escHtml', 'express', 'logLeadActivity', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const createNotification = (...a) => ctx.createNotification(...a);
// Registered on the context by a module that loads later, so these are looked
// up when called rather than when required.
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Contracts (Arabic "عقد شراء وإستيراد سيارة لحساب الغير") ──────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Faithful reproduction of the company's signed paper contract: 6 A4 pages, RTL
// Arabic, company footer on every page. Every blank in the paper form is a field
// here — supplied values are printed inline, blanks fall back to dotted leaders.

function generateContractNo() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `MC${y}${m}-${rand}`;
}

const AR_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// Build the default (prefilled) contract payload from a lead + deal + settings.
function contractDefaults({ customer, deal, settings, vehicle }) {
  const s = settings || {};
  const c = customer || {};
  const d = deal || {};
  const cf = c.custom_fields || {};
  const now = new Date();
  const amount = d.budget_egp || cf.cf_vehicle_price || '';
  // The lead's requested vehicle is free text ("BYD Seal Design") — split it so
  // make/model land in their own rows, exactly like the paper form.
  const carText = String(vehicle || cf.cf_vehicle_offered || cf.cf_vehicle_requested || c.car_in_question || '').trim();
  const carBits = carText.split(/\s+/).filter(Boolean);
  return {
    contractDate: { day: AR_WEEKDAYS[now.getDay()], d: String(now.getDate()).padStart(2, '0'), m: String(now.getMonth() + 1).padStart(2, '0'), y: String(now.getFullYear()) },
    company: {
      name: s.company_name || 'MotoLinkers',
      commercialReg: s.company_commercial_reg || '282378',
      taxId: s.company_tax_id || '773934006',
      address: s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo',
      repIn: s.company_rep || '',
    },
    rep: { name: s.company_rep || '', nationalId: '', idDate: '', nationality: 'مصري', religion: '', address: '', role: 'مدير الشركة' },
    buyer: {
      name: c.name || '', nationalId: cf.cf_national_id || '', idDate: '',
      nationality: 'مصري', religion: 'مسلم', address: c.address || cf.cf_address || '',
    },
    vehicle: {
      make: carBits[0] || '', model: carBits.slice(1).join(' ') || '',
      color: cf.cf_color || '', year: cf.cf_year || '', notes: '',
    },
    importCountry: 'الصين',
    total: amount ? String(amount) : '', totalWords: '',
    payments: [
      { amount: '', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '', when: 'في موعد أقصاه خمسة عشر يوما من تاريخ توقيع هذا العقد', label: 'دفعة الشحن' },
      { amount: '', when: 'عند وصول السيارة الي الموانئ المصرية', label: 'دفعة ضريبه القيمة المضافة' },
      { amount: '', when: 'عند استلام السيارة', label: '' },
    ],
    lateFee: '', lateFeeWords: '',
    deliveryDeadline: '',
  };
}

function buildContractHtml(data) {
  const v = data || {};
  const cd = v.contractDate || {};
  const co = v.company || {}, rp = v.rep || {}, by = v.buyer || {}, ve = v.vehicle || {};
  const pays = Array.isArray(v.payments) ? v.payments : [];

  // A filled blank prints the value (underlined); an empty one keeps the leader
  // dots so the printed contract can still be completed by hand.
  const f = (val, dots = 30) => {
    const t = String(val ?? '').trim();
    return t ? `<u class="fill">${escHtml(t)}</u>` : `<span class="dots">${'.'.repeat(dots)}</span>`;
  };

  const FOOT = `
    <div class="foot">
      <img class="foot-logo" src="${BRAND_LOGO_URL}">
      <div class="foot-lines">
        <div>info@motolinkers.com &nbsp; www.motolinkers.com &nbsp; Tax ID: ${escHtml(co.taxId || '773934006')}</div>
        <div>${escHtml(co.address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo')}</div>
        <div>+2 010 000 78104 &nbsp; REGISTRATION No: ${escHtml(co.commercialReg || '282378')}</div>
      </div>
    </div>`;

  const page = inner => `<section class="page"><div class="content">${inner}</div>${FOOT}</section>`;

  const p1 = `
    <div class="brandbar"><img src="${BRAND_LOGO_URL}"></div>
    <h1>عقد شراء وإستيراد سيارة لحساب الغير</h1>
    <p>إنه في يوم ${f(cd.day, 10)} الموافق ${f(cd.d, 5)} / ${f(cd.m, 5)} / ${f(cd.y, 6)} ، حرر بين كلا من -:</p>
    <p><b>أولا -:</b> شركة / ${f(co.name, 44)} ، ( ش . م . م ) ، سجل تجاري رقم ${f(co.commercialReg, 30)} ،
       بطاقة ضريبية رقم : ${f(co.taxId, 30)} ، ومقرها : ${f(co.address, 46)}
       ويمثلها في هذا العقد ${f(co.repIn || rp.name, 40)}</p>
    <p>الســــيد / ${f(rp.name, 46)} ، ويحمل بطاقة رقم قومي ${f(rp.nationalId, 34)} ،
       صادرة بتاريخ ${f(rp.idDate, 14)} ، ${f(rp.nationality, 10)} الجنسية ، ${f(rp.religion, 10)} الديانة ،
       ومقيم: ${f(rp.address, 40)} ، وذلك بصفه ${f(rp.role, 16)} عن الشركة بموجب تفويض خاص بذلك .</p>
    <p class="ref">( ويشار إليه في هذا العقد بالطرف الأول – المستورد – صاحب الترخيص - البائع )</p>
    <p><b>ثانيا :</b> الســــيد / ${f(by.name, 40)} ، ويحمل بطاقة رقم قومي ${f(by.nationalId, 34)} ،
       صادرة بتاريخ ${f(by.idDate, 14)} ، ${f(by.nationality, 10)} الجنسية ، ${f(by.religion, 10)} الديانة ،
       ومقيم: ${f(by.address, 40)}</p>
    <p class="ref">( ويشار إليه في هذا العقد بالطرف الثاني – المشتري )</p>
    <p>أقر المتعاقدان علي أهليتهما للتصرف وأتفقا علي ما يأتي :</p>`;

  const p2 = `
    <h2>تمهيد</h2>
    <p>حيث أن الطرف الأول هي شركة منشأة طبقا لقوانين جمهورية مصر العربية ، ومتخصصة ومرخص لها بإستيراد وتجارة السيارات من الخارج لداخل مصر ، ولما كان الطرف الثاني يرغب في إستيراد سيارة طبقا للمواصفات الموضحة بالبند الثاني من هذا العقد من خارج جمهورية مصر العربية عن طريق الطرف الأول ، علي أن يتم الإستيراد تحت مسئولية الطرف الأول ولحساب الطرف الثاني ، مع استيفاء كافة النواحي القانونية لتملك الطرف الثاني السيارة مقابل حصول الطرف الأول علي المقابل المذكور بالبند الثالث من هذا العقد ، وبعد أن أقر الطرف الأول بصحة الأوراق ، وتلاقت إرادة الطرفين بعد أن أقرا بأهليتهما الكاملة للتعاقد ، وإتفقا علي ما يلي :</p>
    <h2>البنـد الأول</h2>
    <p>يعتبر التمهيد الوارد بهذا العقد ، وكذا كافة المستندات الخاصة بالشركة الطرف الأول ، وكذا بصفة أطراف هذا العقد في التوقيع عليه ، وكافة المستندات الخاصة بعملية إستيراد وشراء وبيع وترخيص السيارة موضوع هذا العقد جزءاً لا يتجزأ من هذا العقد ومكملا ومتمما لبنوده ، ويقر الطرفان بان هذا العقد يعد عقد وكاله بالعمولة لاستيراد سيارة لحساب الطرف الثاني وفقا لاحكام قانون التجارة المصري والقانون المدني ، ويقتصر دور الطرف الاول علي القيام باجراءات التعاقد مع الموردين والشحن والتخليص الجمركي .</p>
    <h2>البنـد الثاني</h2>
    <p>إتفق طرفي هذا العقد علي أن يقوم الطرف الأول بما له من خبرة وإمكانية في إستيراد السيارة الأتي بيانها لحساب الطرف الثاني طبقا للمواصفات الموضحة فيما بعد ، وذلك علي النحو التالي :</p>`;

  const p3 = `
    <table class="carbox">
      <tr><th>ماركة السيارة:</th><td>${f(ve.make, 34)}</td></tr>
      <tr><th>موديل السيارة:</th><td>${f(ve.model, 34)}</td></tr>
      <tr><th>اللون:</th><td>${f(ve.color, 34)}</td></tr>
      <tr><th>سنة الصنع:</th><td>${f(ve.year, 34)}</td></tr>
      <tr><th>ملاحظات:</th><td>${f(ve.notes, 34)}</td></tr>
    </table>
    <p>علي أن يتم الإستيراد من دولة : ${f(v.importCountry, 24)} ، وعلي ان يحرر ملحق للعقد بالمواصفات الكاملة السيارة عقب التعاقد عليها ويوقع من الطرفين ويلتزم الطرف الأول بما يحتويه من مواصفات لتسليمها للطرف الثاني وعليه فالطرف الأول وحده منفرداً من له الحق في التواصل مع المورد والإتفاق علي كافة المواصفات السالف بيانها او المتفق عليها لاحقا، كما له الحق في التواصـل مع شركة الشحن أو وكيل الشحن فى بلد المورد لاستلام المنتجات من مخزن أو مصنع المورد ونقلها الى ميناء الشحن، والتواصل مع الخط الملاحى للقيام بعملية الشحن حتى ميناء الوصول، والتواصـل مع المستخلص الجمركى لانهاء اجراءات التخليص الجمركى داخل جمهورية مصر العربية وتسليمها للطرف الثاني .</p>
    <p>ويقر الطرف الثاني أن تفاصيل ومواصفات السيارة السالف بيانها قد تم تحديدها وفق رغبته وتعليماته بشكل نهائي ، وبناء عليها سيقوم الطرف الأول بإجراء المفاوضات اللازمة مع الموردين لإستيرادها ، وكذلك إتخاذ كل ما من شأنه إتمام عملية الإستيراد الشخصي ، كما يقر الطرف الثاني بأن تلك التفاصيل تعد غير قابلة لآية تعديلات إلا إذا أجازها الطرف الأول .</p>`;

  const p4 = `
    <h2>البنـد الثالث</h2>
    <p>إتفق طرفا هذا العقد علي أن يلتزم الطرف الثاني بأن يسدد للطرف الأول نظير قيام الأخير بعملية شراء وشحن وإستيراد السيارة لحساب الطرف الثاني، وسداد رسوم الجمارك والتخليص وإتمام إجراءات دخول السيارة إلي داخل مصر مبلغاً قدره ${f(v.total, 20)} ( فقط ${f(v.totalWords, 50)} لا غير ) ، أو ما يعادله بالجنيه المصري وهذا المبلغ يشمل ثمن شراء وإستيراد السيارة وعمولة الطرف الأول بالإضافة إلي كافة الرسوم والضرائب والجمارك في دولة المورد أو داخل مصر ، وكذلك أجور الشحن والنقل والتأمين وكافة التكاليف الناشئة عن إستيراد وجلب السيارة لتسليمها للطرف الثاني وتدفع علي النحو التالي :</p>
    <ul class="pays">
      ${pays.map(p => `<li>مبلغ قدره ${f(p.amount, 22)} جنيه يتم سداده ${escHtml(p.when || '')}${p.label ? ` ( ${escHtml(p.label)} )` : ''} .</li>`).join('')}
    </ul>
    <p>في حال حدوث اي تعديل في الرسوم الجمركية او الضرائب او القرارات المنظمة للاستيراد او سعر الصرف الرسمي للعملات الاجنبية قبل انهاء اجراءات الافراج الجمركي ، يلتزم الطرف الثاني بسداد اي فروق مالية ناتجة عن ذلك .</p>
    <p>وفي حالة تخلف الطرف الثاني عن سداد أي دفعة من الدفعات سالفة البيان في مواعيدها دون مبرر أو سبب مشروع فإنه يلتزم بأن يدفع للطرف الأول قدره ${f(v.lateFee, 30)} جنيه ( فقط وقدره ${f(v.lateFeeWords, 26)} مصريا لا غير ) عن كل يوم تأخير .</p>
    <h2>البنـد الرابع</h2>
    <p>إتفق الطرفان على أن يتم تنفيذ العقد واستيراد السيارة وتسليمها للطرف الثاني بعد انهاء كافة الإجراءات القانونية في موعد غايته ${f(v.deliveryDeadline, 22)} من تاريخ تحرير هذا العقد شرط سداد الإلتزامات المالية من المشتري في مواعيدها، ما لم تحدث أي ظروف قهرية خارجة عن إرادة الطرف الأول وتعيق تنفيذ هذا الإلتزام كظروف الحرب أو تعطيل الخطوط اللوجستية أو الكوارث الطبيعية .</p>
    <p>علي أن يسمح بالتأخير عن الموعد سالف الذكر لمدة اقصاها شهر من انتهاء الموعد المتفق عليه ثم يلتزم الطرف الأول بغرامة تأخير قدرها 0.1% من إجمالي قيمة السيارة عن كل يوم تأخير في التسليم .</p>`;

  const p5 = `
    <h2>البنـد الخامس</h2>
    <p><b>يلتزم الطرف الأول بالأتي:</b></p>
    <ol class="terms">
      <li>بإستيراد السيارة بناء علي طلب الطرف الثاني ووفقا لتعليماته الواردة بالبند الثاني من هذا العقد ، ويضمن أن يسلم الطرف الثاني السيارة طبقا لتلك المواصفات داخل جمهورية مصر العربية .</li>
      <li>بالحصول علي وإستخراج كافة التراخيص وأذونات الإستيراد من الجهات المختصة بجمهورية مصر العربية علي أن تندرج كافة الرسوم والمصاريف ضمن المبلغ المتفق عليه والمذكور بالبند الثالث من هذا العقد .</li>
      <li>بتسليم الطرف الثاني السيارة واستيفاء الأوراق اللازمة بالجمرك لتسجيلها ونقل ملكيتها باسم الطرف الثاني والمحافظة عليها وقت تسليمها .</li>
      <li>يقر الطرف الأول بصحة جميع الأوراق الخاصة بالسيارة ومطابقتها للشروط والمواصفات المتفق عليها الواردة بكتالوج السيارة .</li>
      <li>يقر الطرف الأول بإلتزامه بتسليم السيارة للطرف الثاني دون وجود أي عيوب ظاهرة او غير ظاهرة بالسيارة وخاصة تغيير هيكل السيارة أو وجود بارومة أو أجراء تعديل على الماتور أو الشاسيه أو تغيير الفتيس أو تعديله .</li>
    </ol>
    <p><b>يلتزم الطرف الثاني بالأتي :</b></p>
    <ol class="terms">
      <li>بسداد المبلغ المذكور بالبند الثالث من هذا العقد طبقا للقيم والدفعات والمواعيد المتفق عليها في هذا العقد .</li>
      <li>بإستلام السيارة خلال أسبوع من الموعد المتفق عليه بالبند الرابع من هذا العقد عقب إخطاره من الطرف الأول رسميا بذلك .</li>
      <li>في حال إمتناع الطرف الثاني عن إستلام السيارة المستوردة لحسابه في الموعد المحدد أو الذي يتم إخطاره به بأي وسيلة كانت فإنه يلتزم بآية نفقات أو أجور أو تكاليف أو أرضيات لتخزين السيارة لحين تسليمها له بما لا يتجاوز 0.1% من ثمن السيارة يوميا .</li>
      <li>يلتزم الطرف الثاني بتعويض الطرف الأول عن آية أضرار تصيبه من جراء تأخره عن إستلام السيارة . وفي جميع الأحوال يلتزم الطرف الثاني بتبعية هلاك السيارة إذا وقعت بعد تاريخ إمتناعه عن الإستلام ، وتكون السيارة تحت مسئولية الطرف الثاني أمام جهات الإختصاص داخل جمهورية مصر العربية من تاريخ إستلامها .</li>
      <li>يلتزم الطرف الثاني بأن يتسلم السيارة بشخصه أو من ينوب عنه بموجب توكيل رسمي بذلك . ولا يتم التعامل بأي تفويضات أو غير ذلك من المستندات .</li>
    </ol>`;

  const p6 = `
    <h2>البنـد السادس</h2>
    <p>في حال تراجع الطرف الثاني عن إتمام تنفيذ هذا العقد عقب توقيعه وقبل شحن السيارة محل هذا التعاقد ، فإنه يلزم بأن يدفع للطرف الأول مبلغا وقدره 10% من قيمه السيارة بدون الشحن والجمارك كشرط جزائي نهائي غير قابل للنقض أو التخفيض وغير خاضع لرقابة القضاء ، وهذا المبلغ نظير أتعابه وعمولته وآية مصاريف يكون الطرف الأول قد تكبدها في سبيل تنفيذ هذا العقد. ولا يجوز الغاء التعاقد بعد شحن السيارة .</p>
    <h2>البنـد السابع</h2>
    <p>كل نزاع ينشأ بين الطرفين خاصا بتنفيذ أي شرط من شروط هذا العقد يكون الفصل فيه من اختصاص محكمة شمال القاهرة الإبتدائية وجزئياتها ويقر الطرفان بأن عنوانيهما الموضح بأول هذا العقد هو محل إقامتهما وأية مراسلات أو إعلانات عليه تكون صحيحة ومنتجة قانونا وفي حالة تغير أي من الطرفين محل إقامته يلتزم بإخطار الطرف الآخر بموجب إنذار علي يد محضر أو بخطاب موصي عليه بعلم الوصول .</p>
    <h2>البنـد الثامن</h2>
    <p>يخضع هذا العقد ويتم تفسيره طبقاً لقوانين جمهورية مصر العربية ، ويمثل هذا العقد كامل الاتفاقات ما بين الطرفين ، ويحل محل أي اتفاق آخر أو تفاهم بينهما في هذا الخصوص سواء بالكتابة أو شفوياً ، ولا يجوز تعديل أي بند من بنود هذا العقد إلا بطريق الكتابة وتوقيع أطرافه الموضحين بأول هذا العقد .</p>
    <h2>البند التاسع</h2>
    <p>تحرر هذا العقد من عشرة بنود يقر كل من الطرفين بعلمه بكل ما جاء بها من شروط وأحكام ولا يجوز الرجوع فيها بعد توقيعه علي العقد وتحرر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها .</p>
    <table class="sign">
      <tr>
        <td>
          <div class="sig-h">الطـرف الثانـي</div>
          <div>الاسم : ${f(by.name, 18)}</div>
          <div>الرقم القومي : ${f(by.nationalId, 18)}</div>
          <div>التوقيع : <span class="dots">..................</span></div>
        </td>
        <td>
          <div class="sig-h">الطـرف الأول</div>
          <div>الاسم : ${f(rp.name, 18)}</div>
          <div>الرقم القومي : ${f(rp.nationalId, 18)}</div>
          <div>التوقيع : <span class="dots">..................</span></div>
        </td>
      </tr>
    </table>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Naskh Arabic','Amiri','Traditional Arabic',serif; color:#111; direction:rtl; }
  .page { width:210mm; height:297mm; padding:18mm 16mm 24mm; position:relative; page-break-after:always; overflow:hidden; }
  .page:last-child { page-break-after:auto; }
  .content { font-size:12.5pt; line-height:2.0; text-align:justify; }
  .brandbar { text-align:center; margin:0 0 8mm; }
  .brandbar img { max-height:20mm; width:auto; display:inline-block; }
  h1 { font-size:17pt; text-align:center; margin:0 0 12mm; text-decoration:underline; }
  h2 { font-size:13.5pt; margin:6mm 0 2mm; text-decoration:underline; }
  p  { margin:0 0 3.5mm; }
  .ref { text-align:center; font-weight:700; }
  .fill { text-decoration:underline; font-weight:700; }
  .dots { letter-spacing:1px; color:#444; }
  .carbox { width:100%; border-collapse:collapse; margin:0 0 6mm; }
  .carbox th, .carbox td { border:1px solid #333; padding:2.6mm 3mm; font-size:12.5pt; text-align:right; }
  .carbox th { width:34%; background:#f3f3f3; font-weight:700; }
  ul.pays, ol.terms { margin:0 0 3.5mm; padding-right:7mm; }
  ul.pays li, ol.terms li { margin-bottom:2mm; }
  .sign { width:100%; margin-top:12mm; border-collapse:collapse; }
  .sign td { width:50%; vertical-align:top; padding:4mm; line-height:2.2; }
  .sig-h { font-weight:700; text-decoration:underline; margin-bottom:3mm; }
  .foot { position:absolute; left:16mm; right:16mm; bottom:8mm; border-top:1px solid #c9922a;
          padding-top:2mm; font-family:Arial,Helvetica,sans-serif; direction:ltr;
          font-size:7.6pt; color:#555; line-height:1.5;
          display:flex; align-items:center; gap:4mm; }
  .foot-logo { height:10mm; width:auto; flex-shrink:0; }
  .foot-lines { flex:1; text-align:center; }
</style></head><body>
${page(p1)}${page(p2)}${page(p3)}${page(p4)}${page(p5)}${page(p6)}
</body></html>`;
}

// ── Contract routes ───────────────────────────────────────────────────────────
// Mounted twice: for the dashboard behind requireAuth and for the team portal
// behind requireEmployeeAuth, over one set of handlers rather than two — a fix
// here cannot land in one portal and miss the other. requirePerm waves the admin
// through (they have no req.employee) and checks the action for everyone else.
function mountContractRoutes(base, guard) {
  // ── Contract routes ───────────────────────────────────────────────────────────
  receiver.router.get(base, guard, requirePerm('contracts', 'view'), async (_req, res) => {
    const { data, error } = await supabase.from('contracts')
      .select('id,contract_no,title,status,customer_id,deal_id,created_by,created_at')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  receiver.router.get(`${base}/:id`, guard, requirePerm('contracts', 'view'), async (req, res) => {
    const { data, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Contract not found' });
    res.json(data);
  });

  // Prefill payload for a brand-new contract (optionally seeded from a lead/deal).
  receiver.router.get(`${base}/new/defaults`, guard, requirePerm('contracts', 'create'), async (req, res) => {
    try {
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
      const dealId = req.query.deal_id ? parseInt(req.query.deal_id) : null;
      const [cust, deal, settingsRows] = await Promise.all([
        customerId ? supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data) : null,
        dealId ? supabase.from('deals').select('*').eq('id', dealId).single().then(r => r.data) : null,
        supabase.from('quotation_settings').select('key,value').then(r => r.data),
      ]);
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;
      res.json({ contract_no: generateContractNo(), data: contractDefaults({ customer: cust, deal, settings }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  receiver.router.post(base, guard, requirePerm('contracts', 'create'), express.json({ limit: '2mb' }), async (req, res) => {
    const b = req.body || {};
    const who = callerIdentity(req);
    const row = {
      contract_no: String(b.contract_no || '').trim() || generateContractNo(),
      title: String(b.title || '').trim(),
      data: b.data && typeof b.data === 'object' ? b.data : {},
      customer_id: b.customer_id ? parseInt(b.customer_id) : null,
      deal_id: b.deal_id ? parseInt(b.deal_id) : null,
      status: ['draft', 'signed', 'cancelled'].includes(b.status) ? b.status : 'draft',
      created_by: who.key,
    };
    const { data, error } = await supabase.from('contracts').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
    // Timeline: show the contract on the attached lead's 360° profile
    if (data.customer_id) {
      logLeadActivity(data.customer_id, {
        type: 'note', body: `Contract generated — ${data.contract_no}`,
        meta: { contract_id: data.id, contract_no: data.contract_no },
        authorKey: who.key, authorName: who.name,
      });
    }
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('contracts', 'edit'), express.json({ limit: '2mb' }), async (req, res) => {
    const b = req.body || {};
    const upd = { updated_at: new Date().toISOString() };
    if (b.title != null) upd.title = String(b.title).trim();
    if (b.data && typeof b.data === 'object') upd.data = b.data;
    if (['draft', 'signed', 'cancelled'].includes(b.status)) upd.status = b.status;
    if (b.customer_id !== undefined) upd.customer_id = b.customer_id ? parseInt(b.customer_id) : null;
    const { data, error } = await supabase.from('contracts').update(upd).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('contracts', 'delete'), async (req, res) => {
    const { error } = await supabase.from('contracts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Render the Arabic contract to PDF (reuses the quotation Puppeteer renderer).
  receiver.router.post(`${base}/pdf`, guard, requirePerm('contracts', 'export'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const payload = (req.body && req.body.data) || {};
      const html = buildContractHtml(payload);
      const pdf = await renderQuotationPdf(html);
      res.json({ pdf: Buffer.from(pdf).toString('base64') });
    } catch (e) {
      console.error('[contract-pdf]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Render a saved contract by id (used by the lead profile's document viewer).
  receiver.router.post(`${base}/:id/pdf`, guard, requirePerm('contracts', 'export'), async (req, res) => {
    try {
      const { data: row, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
      if (error || !row) return res.status(404).json({ error: 'Contract not found' });
      const pdf = await renderQuotationPdf(buildContractHtml(row.data || {}));
      res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.contract_no || 'contract' });
    } catch (e) {
      console.error('[contract-pdf-id]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
mountContractRoutes('/api/dashboard/contracts', requireAuth);
mountContractRoutes('/api/employee/contracts', requireEmployeeAuth);

// ── Auto-generate a contract when a deal reaches the Won stage ────────────────
// Idempotent: one contract per deal (guarded by idx_contracts_deal_unique and an
// explicit lookup so re-entering Won never produces duplicates).
async function autoCreateContractForWonDeal(deal) {
  if (!deal || deal.stage !== 'won') return null;
  try {
    const { data: existing } = await supabase.from('contracts').select('id').eq('deal_id', deal.id).maybeSingle();
    if (existing) return null;
    const [cust, settingsRows] = await Promise.all([
      deal.customer_id ? supabase.from('customers').select('*').eq('id', deal.customer_id).single().then(r => r.data) : null,
      supabase.from('quotation_settings').select('key,value').then(r => r.data),
    ]);
    const settings = {};
    for (const row of settingsRows || []) settings[row.key] = row.value;
    const data = contractDefaults({ customer: cust, deal, settings, vehicle: deal.vehicle || deal.title });
    const title = `عقد — ${(cust && cust.name) || deal.title || ''}`.trim();
    const { data: row, error } = await supabase.from('contracts').insert({
      contract_no: generateContractNo(), title, data,
      customer_id: deal.customer_id || null, deal_id: deal.id,
      status: 'draft', created_by: 'auto_won',
    }).select().single();
    if (error) { console.warn('[contract] auto-create failed:', error.message); return null; }
    console.log('[contract] auto-generated', row.contract_no, 'for won deal', deal.id);
    if (deal.customer_id) {
      logLeadActivity(deal.customer_id, {
        type: 'note', body: `Contract ${row.contract_no} generated automatically (deal won)`,
        meta: { contract_id: row.id, contract_no: row.contract_no }, authorKey: 'system', authorName: 'System',
      });
    }
    createNotification('admin', {
      type: 'deal', title: 'Contract ready',
      body: `${title} — ${row.contract_no}`, url: '/dashboard#contracts',
    }, 'always');
    return row;
  } catch (e) { console.warn('[contract] auto-create error:', e.message); return null; }
}


module.exports = { autoCreateContractForWonDeal, buildContractHtml, renderQuotationPdf };
