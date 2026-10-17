'use strict';
// Sample contracts for rendering and tests. The data shape is the contract's `data`
// payload (see contractDefaults in src/routes/contracts.js).

const filled = {
  template: 'sale-v2',
  contractDate: { day: 'الأحد', d: '12', m: '10', y: '2026' },
  company: { name: 'MotoLinkers', commercialReg: '282378', taxId: '773934006',
    address: 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo', repIn: 'محمد ياسر' },
  rep: { name: 'محمد ياسر', nationalId: '29001011234567', idDate: '15/03/2022', nationality: 'مصري', religion: 'مسلم', address: 'مصر الجديدة - القاهرة', role: 'مدير الشركة' },
  buyer: { name: 'عمر حسن محمود', nationalId: '29504151234567', idDate: '02/08/2021', nationality: 'مصري', religion: 'مسلم', address: '12 شارع النصر - مدينة نصر - القاهرة' },
  vehicle: { make: 'مازدا', model: 'EZ60 EV 600 Max', color: 'أبيض', year: '2026', notes: 'شاحن حائط وكابل ومجموعة إصلاح الإطارات' },
  importCountry: 'الصين',
  total: '1915050', totalWords: 'مليون وتسعمائة وخمسة عشر ألفا وخمسون جنيها مصريا',
  payments: [{ amount: '1340535', when: 'فور التوقيع علي هذا العقد', label: '' }],
  lateFee: '', lateFeeWords: '', deliveryDeadline: '',
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
  // A contract saved before the car-sale wording: it must still render its ORIGINAL text.
  contractLegacy: { ...filled, template: undefined, lateFee: '500', lateFeeWords: 'خمسمائة', deliveryDeadline: '45 يوما',
    payments: [
      { amount: '600000', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '300000', when: 'في موعد أقصاه خمسة عشر يوما من تاريخ توقيع هذا العقد', label: 'دفعة الشحن' },
      { amount: '200000', when: 'عند وصول السيارة الي الموانئ المصرية', label: 'دفعة ضريبه القيمة المضافة' },
      { amount: '815050', when: 'عند استلام السيارة', label: '' },
    ] },
};
