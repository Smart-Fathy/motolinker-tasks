'use strict';
// Sample contracts for rendering and tests. The data shape is the contract's `data`
// payload (see contractDefaults in src/routes/contracts.js). Everything here is the car-sale
// contract ('sale-v2') except `contractLegacy`, which is the older wording.
//
//   contract            every blank filled in, one payment line
//   contractBlank       nothing filled in: every blank is a dotted leader
//   contractLong        long names and addresses, long notes, three payment lines
//   contractHostile     markup in free-text fields
//   contractMixed       Arabic, Latin and digits in the same fields
//   contractUnbroken    a single very long word in each long field
//   contractLegacy      a contract saved before the car-sale wording (no template), written out in full
//
//   node tools/render-docs.js contract contractLong contractBlank --dpi 100 --out /tmp/docs

const filled = {
  template: 'sale-v2',
  contractNo: 'MC2610-1234',
  contractDate: { day: 'الأحد', d: '12', m: '10', y: '2026' },
  company: { name: 'MotoLinkers', commercialReg: '282378', taxId: '773934006',
    address: 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo', repIn: 'محمد ياسر' },
  rep: { name: 'محمد ياسر', nationalId: '29001011234567', idDate: '15/03/2022', nationality: 'مصري', religion: 'مسلم', address: 'مصر الجديدة - القاهرة', role: 'مدير الشركة' },
  buyer: { name: 'عمر حسن محمود', nationalId: '29504151234567', idDate: '02/08/2021', nationality: 'مصري', religion: 'مسلم', address: '12 شارع النصر - مدينة نصر - القاهرة' },
  vehicle: { make: 'مازدا', model: 'EZ60 EV 600 Max', color: 'أبيض', year: '2026', notes: 'شاحن حائط وكابل ومجموعة إصلاح الإطارات' },
  total: '1915050', totalWords: 'مليون وتسعمائة وخمسة عشر ألفا وخمسون جنيها مصريا',
  payments: [{ amount: '1340535', when: 'فور التوقيع علي هذا العقد', label: '' }],
};

module.exports = {
  contract: filled,
  // Every blank left for filling in by hand: the leader dots must print.
  contractBlank: { template: 'sale-v2', contractDate: {}, company: {}, rep: {}, buyer: {}, vehicle: {}, payments: [{}] },
  // Long values everywhere: nothing may be cut off or overflow its box.
  contractLong: {
    ...filled,
    company: { ...filled.company, name: 'شركة موتو لينكرز لاستيراد وتجارة السيارات الكهربائية والهجينة ذات المسئولية المحدودة', address: filled.company.address + ' — المبنى الإداري الرئيسي بجوار مجمع المحاكم والنيابة العامة' },
    buyer: { ...filled.buyer, name: 'عبد الرحمن محمد عبد العزيز إبراهيم السيد الشناوي', address: 'عمارة رقم 14 - الدور الثالث - شقة 9 - شارع الجمهورية المتفرع من شارع الهرم - الجيزة - جمهورية مصر العربية' },
    vehicle: { ...filled.vehicle, notes: 'ملاحظات طويلة جدا '.repeat(12) },
    payments: [
      { amount: '500000', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '600000', when: 'عند وصول السيارة الي الموانئ المصرية', label: 'دفعة الشحن' },
      { amount: '815050', when: 'عند استلام السيارة', label: '' },
    ],
  },
  // Markup in every free-text field: it must print as text, never as HTML.
  contractHostile: { ...filled, buyer: { ...filled.buyer, name: '<img src=x onerror=alert(1)> "عمر" & Sons', address: '</u><h1>boom</h1>' } },
  // Arabic, Latin and digits in the same field: nothing may reorder or leak out of its place.
  contractMixed: {
    ...filled,
    contractNo: 'MC2610-0007',
    company: { ...filled.company, name: 'MotoLinkers Egypt (ش.م.م)', repIn: 'Mohamed Yasser محمد ياسر' },
    rep: { ...filled.rep, name: 'Mohamed Yasser محمد ياسر', nationalId: '٢٩٠٠١٠١١٢٣٤٥٦٧', idDate: '15 مارس 2022', address: 'Heliopolis, Cairo — مصر الجديدة' },
    buyer: { ...filled.buyer, name: 'Ahmed Kamal أحمد كمال', nationalId: '29504151234567', idDate: '2021/08/02', nationality: 'Egyptian', religion: 'Muslim',
      address: '12 شارع النصر - Block 7B - Nasr City (مدينة نصر)' },
    vehicle: { make: 'BYD', model: 'Seal 2025 AWD 82.5 kWh', color: 'أبيض لؤلؤي (Pearl White)', year: '2025', notes: 'Tel: +20 100 123 4567 - طلب خاص #12 (شاحن 22kW)' },
    total: '2,450,000.50', totalWords: 'مليونان وأربعمائة وخمسون ألف جنيه وخمسون قرشا لا غير',
    payments: [
      { amount: '1,000,000', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '1450000.50', when: 'عند استلام السيارة (Delivery) في موعد أقصاه 30/11/2026', label: 'الدفعة الأخيرة' },
    ],
  },
  // A single 90-character token in each long field: it must wrap inside its box, never run out of it.
  contractUnbroken: {
    ...filled,
    contractNo: 'MC26-' + '9'.repeat(95),
    company: { ...filled.company, repIn: 'A'.repeat(90), address: 'B'.repeat(95) },
    rep: { ...filled.rep, name: 'محمد'.repeat(25), address: 'C'.repeat(88) },
    buyer: { ...filled.buyer, name: 'D'.repeat(92), address: 'عنوان'.repeat(30) },
    vehicle: { ...filled.vehicle, notes: 'E'.repeat(120) },
    totalWords: 'ألف'.repeat(40),
  },
  // A contract saved before the car-sale wording: it must still render its ORIGINAL text. It is written out in
  // full and shares nothing with the fixtures above: the test pins the hash of its HTML, and a change to a
  // sale fixture must never move that.
  contractLegacy: {
    contractDate: { day: 'الأحد', d: '12', m: '10', y: '2026' },
    company: { name: 'MotoLinkers', commercialReg: '282378', taxId: '773934006',
      address: 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo', repIn: 'محمد ياسر' },
    rep: { name: 'محمد ياسر', nationalId: '29001011234567', idDate: '15/03/2022', nationality: 'مصري', religion: 'مسلم', address: 'مصر الجديدة - القاهرة', role: 'مدير الشركة' },
    buyer: { name: 'عمر حسن محمود', nationalId: '29504151234567', idDate: '02/08/2021', nationality: 'مصري', religion: 'مسلم', address: '12 شارع النصر - مدينة نصر - القاهرة' },
    vehicle: { make: 'مازدا', model: 'EZ60 EV 600 Max', color: 'أبيض', year: '2026', notes: 'شاحن حائط وكابل ومجموعة إصلاح الإطارات' },
    total: '1915050', totalWords: 'مليون وتسعمائة وخمسة عشر ألفا وخمسون جنيها مصريا',
    importCountry: 'الصين', lateFee: '500', lateFeeWords: 'خمسمائة', deliveryDeadline: '45 يوما',
    payments: [
      { amount: '600000', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '300000', when: 'في موعد أقصاه خمسة عشر يوما من تاريخ توقيع هذا العقد', label: 'دفعة الشحن' },
      { amount: '200000', when: 'عند وصول السيارة الي الموانئ المصرية', label: 'دفعة ضريبه القيمة المضافة' },
      { amount: '815050', when: 'عند استلام السيارة', label: '' },
    ],
  },
};
