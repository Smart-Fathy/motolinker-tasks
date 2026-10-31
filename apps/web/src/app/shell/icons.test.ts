import { BOTTOM_NAV, NAV, presentation, screenOf } from '@motolinker/contracts/modules';
import { describe, expect, it } from 'vitest';
import { COLUMN_ICONS } from '../../columns/model';
import { ISSUE_ICONS } from '../../modules/issues/model';
import { CAL_ICONS } from '../../modules/calendar/model';
import { MEET_ICONS } from '../../modules/meet/model';
import { TYPE_ICONS } from '../../modules/notifications/model';
import { ACCOUNT_ICONS } from '../../modules/security/model';
import { SUPPLIER_ICONS } from '../../modules/suppliers/model';
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
    for (const icon of Object.values(MEET_ICONS)) wanted.add(icon);
    for (const icon of Object.values(CAL_ICONS)) wanted.add(icon);
    for (const icon of Object.values(ACCOUNT_ICONS)) wanted.add(icon);
    for (const icon of Object.values(COLUMN_ICONS)) wanted.add(icon);
    for (const icon of Object.values(SUPPLIER_ICONS)) wanted.add(icon);
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
      ...Object.values(MEET_ICONS),
      ...Object.values(CAL_ICONS),
      ...Object.values(ACCOUNT_ICONS),
      ...Object.values(COLUMN_ICONS),
      ...Object.values(SUPPLIER_ICONS),
    ]);
    for (const portal of portals) {
      for (const g of NAV[portal])
        for (const id of g.items) drawn.add(presentation(screenOf(id)!, portal).icon);
      for (const b of BOTTOM_NAV[portal]) drawn.add(b.icon);
    }
    expect(Object.keys(ICONS).filter(name => !drawn.has(name))).toEqual([]);
  });
});
