'use strict';
// HTML → PDF for every generated document. One implementation, so the quotation, the
// contract, the purchase order and the finance reports all go through the same locked-
// down browser.
//
// Headless Chrome, with every request that isn't an inline data: URL or https: refused —
// that stops authored/injected markup from reading file:// or reaching internal http://
// addresses. The brand fonts and logos are embedded as data URIs (see ./brand.js), so a
// document never waits on the network to look right.
//
// The executable comes from puppeteer's own download; set PUPPETEER_EXECUTABLE_PATH to
// use a different Chrome (the tests and the sample renderer do).

async function renderPdf(html, opts) {
  const { landscape = false } = opts || {};
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith('data:') || u.startsWith('https:')) r.continue();
      else r.abort();
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // Make sure every embedded font is decoded before the page is printed.
    await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
    return await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      // The page margins live in the document's own @page rule (brand.js), where the
      // page-number box needs them.
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await browser.close();
  }
}

module.exports = { renderPdf };
