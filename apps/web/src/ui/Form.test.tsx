import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormLabel } from './Form';

afterEach(cleanup);

describe('the label of a form field', () => {
  it('has the sheet’s own class, and, where a page asks, that page’s as well', () => {
    render(
      <>
        <FormLabel htmlFor="a">Plain</FormLabel>
        <FormLabel htmlFor="b" className="mine">
          Mine
        </FormLabel>
      </>,
    );
    const [plain, mine] = [...document.querySelectorAll('label')];
    expect(plain!.className).toMatch(/label/);
    expect(plain!.className).not.toMatch(/mine/);
    expect(mine!.className).toMatch(/label/);
    expect(mine!.className).toMatch(/mine/);
    expect(plain!.getAttribute('for')).toBe('a');
    expect(plain!.getAttribute('data-part')).toBe('label');
  });
});
