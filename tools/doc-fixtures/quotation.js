'use strict';
// Sample quotations for rendering and tests. The first mirrors the company's real
// "Mazda EZ60" quotation (MT28W88Y26) so a redesign can be compared with the original.

// A neutral stand-in for a car photo: a soft gradient with a simple silhouette.
const photo = (a, b, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="800" height="500" fill="url(#g)"/>
    <path d="M110 330 q20-90 120-100 l90-50 q40-22 100-22 h120 q60 0 100 40 l60 40 q50 8 60 60 v40 h-60 a50 50 0 0 0-100 0 h-240 a50 50 0 0 0-100 0 h-150z" fill="rgba(255,255,255,.55)"/>
    <circle cx="260" cy="372" r="40" fill="rgba(4,54,39,.55)"/><circle cx="560" cy="372" r="40" fill="rgba(4,54,39,.55)"/>
    <text x="400" y="470" text-anchor="middle" font-family="sans-serif" font-size="26" fill="rgba(4,54,39,.6)">${label}</text></svg>`);

const SPECS = [
  { key: '', val: 'Pure Electric (BEV) 600 km CLTC Driving Range Rear-Wheel Drive (RWD)' },
  { key: '', val: '190 kW (258 hp) Electric Motor 320 Nm Maximum Torque 80 kWh Battery Pack DC Fast Charging 20" Alloy Wheels Panoramic Glass Roof' },
  { key: '', val: 'Frameless Doors Hidden Door Handles 26.45" 23-Speaker Premium Audio System Heated & Ventilated Front Seats Wireless Phone Charging 360° Panoramic Camera Adaptive Cruise Control (ACC) L2 Intelligent Driving Assist Automatic Parking Assist Powered Tailgate' },
];

const base = {
  id: 'MT28W88Y26', date: '2026-07-08', validTo: '2026-07-15', name: 'Omar Hassan',
  vehicleModel: 'Mazda EZ60 EV 600 Max',
  items: [
    { name: 'Mazda EZ60 EV 600 Max', unit: 1, priceUsd: '22500' },
    { name: 'Wall mount', unit: 1, priceUsd: '200' },
    { name: 'Cable', unit: 1, priceUsd: '50' },
    { name: 'English Software', unit: 1, priceUsd: 'Free' },
    { name: 'Tire Repair kit', unit: 1, priceUsd: 'Free' },
    { name: 'Electric Pump', unit: 1, priceUsd: 'Free' },
  ],
  logistics: [
    { label: 'Ocean Freight', priceUsd: '4000' },
    { label: 'THC, Documentation & Clearances', priceUsd: '2500' },
    { label: 'Customs Vat & Tax', priceUsd: '4700' },
    { label: 'Last Mile Wench to Door', priceUsd: '100' },
    { label: 'Service Fees', priceUsd: '3500' },
  ],
  currency: 'EGP', exchange: '51', issuer: 'Mohamed Yasser',
  customSpecs: SPECS,
  settings: { payment_terms: '70% Deposit & Operation Kick-off\n20% Upon Logistics\n10% On Arrival to Egypt' },
  template: 'motolinkers',
};

const images = [photo('#dff0d4', '#9fcb86', 'Front'), photo('#e8f3df', '#b7d9a3', 'Side'), photo('#d4e8c8', '#8fbf74', 'Rear'), photo('#eef6e8', '#a9d28f', 'Interior')];
const LONG_WORD = 'Supercalifragilisticexpialidocious'.repeat(3);

module.exports = {
  // Exactly the original's content, no photos.
  quotation: base,
  // With the photo strip.
  quotationImages: { ...base, imageDataUrls: images },
  // Five photos — the most the editor allows.
  quotationFivePhotos: { ...base, imageDataUrls: [...images, photo('#e1f0d6', '#a3cf89', 'Detail')] },
  // Long enough to run onto a second page: the table header and footer must repeat.
  quotationLong: {
    ...base, imageDataUrls: images.slice(0, 3),
    items: [
      ...base.items,
      ...Array.from({ length: 14 }, (_, i) => ({ name: `Optional accessory ${i + 1} — extended description that wraps onto a second line to test the row height`, unit: (i % 3) + 1, priceUsd: String(120 + i * 35) })),
    ],
    logistics: [...base.logistics, ...Array.from({ length: 8 }, (_, i) => ({ label: `Additional logistics line ${i + 1}`, priceUsd: String(250 + i * 40) }))],
    customSpecs: [...SPECS, ...Array.from({ length: 10 }, (_, i) => ({ key: `Spec ${i + 1}`, val: 'A longer value describing this specification in a sentence or two so the card has real height to lay out.' }))],
  },
  // One photo, and three: the strip must look intentional with fewer than four.
  quotationOnePhoto: { ...base, imageDataUrls: [images[1]] },
  quotationThreePhotos: { ...base, imageDataUrls: [images[0], images[1], images[2]] },
  // Neither an issuer nor a spec: the specs card is left out and payment terms take the full width.
  quotationNoSpecs: { ...base, issuer: '', customSpecs: [], imageDataUrls: images.slice(0, 3) },
  // The kinds of lines real quotes have: a vehicle with a clear separator (title + grey subtitle),
  // a unit above 1, a fractional exchange rate, lower-case "free", a blank price, and a price that
  // is words rather than a number (printed as typed, left out of the total).
  quotationMixed: {
    ...base, id: 'MT05W12Y26', date: '2026-10-05', validTo: '2026-10-12', name: 'Mona Said',
    vehicleModel: 'BYD Seal — Design 700 km AWD', exchange: '50.75',
    imageDataUrls: images.slice(0, 2),
    items: [
      { name: 'BYD Seal Design 700 km AWD', unit: 1, priceUsd: '31900' },
      { name: 'Wall box 7 kW', unit: 2, priceUsd: '320.5' },
      { name: 'Floor mats', unit: 1, priceUsd: 'free' },
      { name: 'Extended warranty (3 years)', unit: 1, priceUsd: 'TBC' },
      { name: 'Window tint', unit: 1, priceUsd: '' },
    ],
    customSpecs: [
      { key: 'Incoterms', val: 'CIF Alexandria' },
      { key: '', val: 'Delivery within 60 days of the down payment' },
      { key: 'Warranty', val: '3 years / 100,000 km' },
    ],
    settings: { payment_terms: '100% Advance payment\nBalance on delivery in Cairo', footer_note: 'Prices subject to change without notice' },
  },
  // Arabic names and words inside an English document: Cairo carries the Arabic, the order is right.
  quotationArabic: {
    ...base, name: 'عمر حسن', vehicleModel: 'مازدا EZ60 — EV 600 Max',
    items: [
      { name: 'سيارة مازدا EZ60 كهربائية بالكامل (2026)', unit: 1, priceUsd: '22500' },
      { name: 'Wall mount شاحن جداري', unit: 1, priceUsd: '200' },
      { name: 'حقيبة أدوات', unit: 1, priceUsd: 'Free' },
    ],
    customSpecs: [{ key: 'الضمان', val: '3 سنوات أو 100,000 كم' }, { key: '', val: 'تسليم خلال 60 يوماً من الدفعة المقدمة (Delivery in 60 days)' }],
  },
  // Sparse: no vehicle, no specs, one line — nothing may break or print "undefined".
  quotationMinimal: {
    id: 'MT01W01Y26', date: '2026-01-02', validTo: '2026-01-09', name: '',
    vehicleModel: '', items: [{ name: 'Vehicle', unit: 1, priceUsd: '10000' }], logistics: [],
    currency: 'USD', exchange: '1', issuer: '', customSpecs: [], settings: {},
  },
  // Words with no break in them, an enormous price, a thousand units and a long footer note:
  // everything must wrap inside its box, and the page furniture must stay where it is.
  quotationStress: {
    ...base, imageDataUrls: images,
    id: 'MT' + '9'.repeat(30), name: LONG_WORD, vehicleModel: `BYD Seal ${LONG_WORD}`,
    items: [
      { name: LONG_WORD + LONG_WORD, unit: 1, priceUsd: '123456789012' },
      { name: 'Normal item', unit: 1000, priceUsd: '99999.99' },
    ],
    logistics: [{ label: LONG_WORD, priceUsd: '5' }],
    customSpecs: [
      { key: 'A very long key '.repeat(4), val: `${LONG_WORD} ${LONG_WORD}` },
      { key: '', val: 'line one\nline two\nline three' },
    ],
    exchange: '50.123456789',
    settings: { payment_terms: `100% ${LONG_WORD}\n${LONG_WORD}`, footer_note: 'A footer note that runs on and on. '.repeat(6) },
  },
  // Markup in every free-text field: it must print as text, never as HTML.
  quotationHostile: {
    ...base, name: '<img src=x onerror=alert(1)> Omar & "Sons"', vehicleModel: '<b>BYD</b> Seal "Design"',
    items: [{ name: '<script>alert(1)</script> Wall mount', unit: 1, priceUsd: '200' }],
    customSpecs: [{ key: '<i>k</i>', val: '</div><h1>boom</h1>' }],
  },
};
