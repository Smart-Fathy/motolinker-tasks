// Domain vocabulary shared across features.
//
// These lived scattered through index.js, several of them declared hundreds of
// lines AFTER the code that reads them — legal only because the reads happen at
// request time. That forward reference is what stopped feature blocks from being
// pulled into their own modules, so the shared vocabulary lives here instead.

const LEADS_ENUM_DEFAULTS = {
  status: [['cold','Cold'],['warm','Warm'],['hot','Hot'],['immediate_delivery','Immediate Delivery'],['not_interested','Not Interested'],['blacklist','Blacklist']],
  source: [['fb_ad','FB Ad.'],['whatsapp','Whatsapp'],['messenger','Messenger'],['direct_call','Direct Call'],['ig_ads','IG ads'],['website','Website'],['walk_in','Walk-in'],['marketplace','Marketplace']],
  next_action: [['followed_by_sales','Followed By Sales'],['need_follow_up','Need Follow Up'],['closed','Closed'],['no_answer','No Answer']],
};

const PO_LINE_STATUSES = [
  { key: 'send_to_supplier', label: 'SEND TO SUPPLIER',      bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'in_preparation',   label: 'Car in Preparation',    bg: '#f3ddf7', fg: '#7b2d8e' },
  { key: 'in_logistics',     label: 'In Logistics',          bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'delivered',        label: 'Car Delivered to moto', bg: '#d7f2d9', fg: '#1e6b2a' },
];
const PO_LINE_STATUS_KEYS = PO_LINE_STATUSES.map(s => s.key);

const BRAND_LOGO_URL = 'https://images.motolinkers.com/avatar-11-max-reev/motolinkers-logo-black-text-preview.png';

module.exports = { LEADS_ENUM_DEFAULTS, PO_LINE_STATUSES, PO_LINE_STATUS_KEYS, BRAND_LOGO_URL };
