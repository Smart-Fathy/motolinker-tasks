import { BOTTOM_NAV, NAV, presentation, screenOf } from '@motolinker/contracts/modules';
import { describe, expect, it } from 'vitest';
import { ISSUE_ICONS } from '../../modules/issues/model';
import { TYPE_ICONS } from '../../modules/notifications/model';
import { ICONS } from './icons';

describe('the icons', () => {
  const portals = ['admin', 'team'] as const;

  it("include every icon the rails draw, in either portal's words (the brain is drawn apart)", () => {
    const wanted = new Set<string>();
    for (const portal of portals) {
      for (const g of NAV[portal])
        for (const id of g.items) wanted.add(presentation(screenOf(id)!, portal).icon);
      for (const b of BOTTOM_NAV[portal]) wanted.add(b.icon);
    }
    wanted.add('log-out').add('arrow-left').add('shield-check').add('bell');
    for (const icon of Object.values(TYPE_ICONS)) wanted.add(icon);
    for (const icon of Object.values(ISSUE_ICONS)) wanted.add(icon);
    wanted.delete('brain-ai');
    expect([...wanted].filter(name => !(name in ICONS))).toEqual([]);
  });

  it('are not padded with ones nobody draws', () => {
    const drawn = new Set<string>([
      'log-out',
      'arrow-left',
      'shield-check',
      ...Object.values(TYPE_ICONS),
      ...Object.values(ISSUE_ICONS),
    ]);
    for (const portal of portals) {
      for (const g of NAV[portal])
        for (const id of g.items) drawn.add(presentation(screenOf(id)!, portal).icon);
      for (const b of BOTTOM_NAV[portal]) drawn.add(b.icon);
    }
    expect(Object.keys(ICONS).filter(name => !drawn.has(name))).toEqual([]);
  });
});
