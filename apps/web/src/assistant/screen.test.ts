import { afterEach, describe, expect, it } from 'vitest';
import { readScreen } from './screen';

afterEach(() => {
  document.body.innerHTML = '';
});

const page = (html: string): HTMLElement => {
  const root = document.createElement('main');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
};

describe('what is on the screen', () => {
  it('is nothing from a page with nothing to say, or none', () => {
    expect(readScreen(null, 'leads')).toEqual({});
    expect(readScreen(page('<p>Hello</p>'), 'leads')).toEqual({});
  });

  it('is the tab that is selected', () => {
    const root = page(`
      <div role="tablist">
        <button role="tab" aria-selected="false">Cards</button>
        <button role="tab" aria-selected="true">  Table
          view </button>
      </div>`);
    expect(readScreen(root, 'suppliers')).toEqual({ tab: 'Table view' });
  });

  it('is the first search box with words in it (and not one that is empty, or hidden)', () => {
    const root = page(`
      <input type="search" value="" />
      <input type="text" placeholder="Search leads" value="  ahmed  hassan " />
      <input type="search" value="other" />`);
    expect(readScreen(root, 'leads')).toEqual({ search: 'ahmed hassan' });
    const hidden = page(`<div hidden><input type="search" value="secret" /></div>`);
    expect(readScreen(hidden, 'leads')).toEqual({});
  });

  it('leaves out what is hidden from a screen reader too, where the browser cannot say what is on show', () => {
    const hidden = page(`<div aria-hidden="true"><input type="search" value="secret" /></div>`);
    expect(readScreen(hidden, 'leads')).toEqual({});
    const shown = page(`<div aria-hidden="false"><input type="search" value="plain" /></div>`);
    expect(readScreen(shown, 'leads')).toEqual({ search: 'plain' });
  });

  it('is the filters that are not at "everything": selects by what they are called, and dates', () => {
    const root = page(`
      <select id="f-status"><option value="">All</option><option value="hot" selected>Hot leads</option></select>
      <select name="source"><option value="all" selected>All sources</option></select>
      <select aria-label="Owner"><option value="2" selected>  Ana   A. </option></select>
      <select><option value="any" selected>Any</option></select>
      <input type="date" id="lead-from" value="2026-10-01" />
      <input type="date" id="lead-to" value="" />`);
    expect(readScreen(root, 'leads')).toEqual({
      filters: { status: 'Hot leads', Owner: 'Ana A.', from: '2026-10-01' },
    });
  });

  it("leaves out the selects of a dialog, which are the form's and not the page's", () => {
    const root = page(`
      <div role="dialog"><select id="x"><option value="a" selected>A</option></select></div>`);
    expect(readScreen(root, 'leads')).toEqual({});
  });

  it('keeps to eight select filters', () => {
    const selects = Array.from(
      { length: 12 },
      (_, i) => `<select id="s${i}"><option value="v${i}" selected>Value ${i}</option></select>`,
    ).join('');
    const filters = readScreen(page(selects), 'leads').filters ?? {};
    expect(Object.keys(filters)).toHaveLength(8);
    expect(filters['s7']).toBe('Value 7');
    expect(filters['s8']).toBeUndefined();
  });

  it('is the rows that are ticked, as what the section calls them, ten at most', () => {
    const rows = Array.from(
      { length: 12 },
      (_, i) =>
        `<tr data-id="${i + 1}"><td><input type="checkbox" ${i % 2 === 0 ? 'checked' : ''} /> Row ${i + 1}</td></tr>`,
    ).join('');
    const root = page(
      `<table><tbody>${rows}</tbody></table><tr><td><input type="checkbox" checked /> no id</td></tr>`,
    );
    const selected = readScreen(root, 'leads').selected ?? [];
    expect(selected).toHaveLength(6);
    expect(selected[0]).toEqual({ kind: 'lead', id: '1', title: 'Row 1' });
    expect(readScreen(root, 'deals').selected?.[0]?.kind).toBe('deal');
    expect(readScreen(root, 'tasks').selected?.[0]?.kind).toBe('task');
    expect(readScreen(root, 'suppliers').selected?.[0]?.kind).toBe('row');
    const many = Array.from(
      { length: 14 },
      (_, i) => `<tr data-id="${i}"><td><input type="checkbox" checked /> r</td></tr>`,
    ).join('');
    expect(readScreen(page(`<table>${many}</table>`), 'leads').selected).toHaveLength(10);
  });

  it('keeps the long words of a page to the length the server keeps', () => {
    const root = page(`
      <button role="tab" aria-selected="true">${'t'.repeat(100)}</button>
      <input type="search" value="${'s'.repeat(200)}" />`);
    const read = readScreen(root, 'leads');
    expect(read.tab).toHaveLength(40);
    expect(read.search).toHaveLength(80);
  });
});
