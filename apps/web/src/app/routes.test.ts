import { afterEach, describe, expect, it } from 'vitest';
import { startScreen } from './routes';

afterEach(() => localStorage.clear());

describe('where a bare address opens', () => {
  it('is Home when nothing was left, or what was left is not a page', () => {
    expect(startScreen('admin', () => true)).toBe('home');
    localStorage.setItem('ml_page', 'nonsense');
    expect(startScreen('admin', () => true)).toBe('home');
    localStorage.setItem('ml_page', '');
    expect(startScreen('admin', () => true)).toBe('home');
  });

  it("is the page the person was last on, read in the classic portal's words, if they may still open it", () => {
    localStorage.setItem('ml_page', 'customers');
    expect(startScreen('admin', () => true)).toBe('leads');
    localStorage.setItem('ml_emp_page', 'log');
    expect(startScreen('team', () => true)).toBe('hours');
  });

  it('is Home when they may not (the grant was taken away since), rather than a page that would send them there', () => {
    localStorage.setItem('ml_emp_page', 'leads');
    expect(startScreen('team', id => id !== 'leads')).toBe('home');
  });

  it('is never a panel (Security opens over a page; starting there would only open it again, for ever)', () => {
    localStorage.setItem('ml_emp_page', 'security');
    expect(startScreen('team', () => true)).toBe('home');
    localStorage.setItem('ml_page', 'security');
    expect(startScreen('admin', () => true)).toBe('home');
  });

  it("keeps each portal's own memory", () => {
    localStorage.setItem('ml_page', 'deals');
    expect(startScreen('team', () => true)).toBe('home');
    expect(startScreen('admin', () => true)).toBe('deals');
  });
});
