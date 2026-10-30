import { describe, expect, it } from 'vitest';
import { adminMe, teamMe } from '../test/helpers';
import { accessOf } from './access';
import { buildBottomNav, buildRail, readNavConfig, type NavConfig } from './nav';

const ids = (groups: { items: { id: string }[] }[]) => groups.map(g => g.items.map(i => i.id));
const shape = (groups: { id: string; items: { id: string }[] }[]) =>
  groups.map(g => [g.id, g.items.map(i => i.id)]);

describe('the rail', () => {
  it('gives the admin every screen of the admin portal, in the classic order, Google Chat only where it is set up', () => {
    const rail = buildRail('admin', accessOf(adminMe()));
    expect(rail.map(g => g.id)).toEqual([
      'management',
      'crm',
      'finance',
      'logistics',
      'integrations',
      'chat',
      'google',
      'system',
    ]);
    expect(rail[0]?.items.map(i => i.id)).toEqual([
      'home',
      'tasks',
      'employees',
      'requests',
      'hours',
      'approvals',
    ]);
    expect(rail[6]?.items.map(i => i.id)).toEqual(['calendar', 'meet', 'email', 'drive', 'sheets']);
    const withChat = buildRail('admin', accessOf(adminMe({ gchat: true })));
    expect(withChat[6]?.items.map(i => i.id)).toEqual([
      'calendar',
      'meet',
      'gchat',
      'email',
      'drive',
      'sheets',
    ]);
  });

  it('names things as the portal does: the team says My Tasks and Inventory, the admin Tasks and Inventory & Logistics', () => {
    const team = buildRail(
      'team',
      accessOf(teamMe({ tasks: true, stock: true, stockActions: { browse: true } })),
    );
    const mine = Object.fromEntries(team.flatMap(g => g.items).map(i => [i.id, i.label]));
    expect(mine).toMatchObject({ tasks: 'My Tasks', stock: 'Inventory' });
    const admin = Object.fromEntries(
      buildRail('admin', accessOf(adminMe()))
        .flatMap(g => g.items)
        .map(i => [i.id, i.label]),
    );
    expect(admin).toMatchObject({
      tasks: 'Tasks',
      stock: 'Inventory & Logistics',
      approvals: 'Approvals',
      leads: 'Leads',
    });
  });

  it('gives a team member the screens they were granted, and no heading with nothing under it', () => {
    const rail = buildRail(
      'team',
      accessOf(
        teamMe({
          tasks: true,
          requests: true,
          hours: true,
          hoursActions: { log: true },
          leads: true,
        }),
      ),
    );
    expect(shape(rail)).toEqual([
      ['management', ['home', 'tasks', 'hours', 'requests']],
      ['crm', ['leads']],
      ['chat', ['chat']],
      ['google', ['calendar', 'meet', 'drive', 'sheets']],
      ['system', ['notifications']],
    ]);
  });

  it('gives somebody with nothing granted only what nobody is locked out of', () => {
    const rail = buildRail(
      'team',
      accessOf(
        teamMe({
          tasks: false,
          requests: false,
          hours: false,
          chat: false,
          calendar: false,
          meet: false,
          drive: false,
          sheets: false,
          stock: false,
        }),
      ),
    );
    expect(shape(rail)).toEqual([
      ['management', ['home']],
      ['system', ['notifications']],
    ]);
  });

  it('gives the Issues screen to the CTO by title, whatever they were granted', () => {
    const rail = buildRail('team', accessOf(teamMe({}, 'Chief Technical Officer')));
    expect(rail.find(g => g.id === 'system')?.items.map(i => i.id)).toEqual([
      'notifications',
      'issues',
    ]);
    expect(ids(buildRail('team', accessOf(teamMe({}, 'Sales')))).flat()).not.toContain('issues');
  });

  it('never gives a team member a screen that is for the admin alone', () => {
    const everything = Object.fromEntries(
      ['requests', 'tasks', 'hours', 'leads', 'deals', 'chat', 'stock'].map(s => [s, true]),
    );
    const all = ids(
      buildRail('team', accessOf(teamMe(everything, 'Chief Technical Officer'))),
    ).flat();
    for (const adminOnly of ['employees', 'approvals', 'automations', 'whatsapp', 'workspace'])
      expect(all).not.toContain(adminOnly);
  });
});

describe("the admin's arrangement", () => {
  const admin = accessOf(adminMe());
  const cfg = (groups: NavConfig['groups']): NavConfig => ({ groups });

  it('is the shipped rail when nobody arranged anything, however empty the saved arrangement is', () => {
    const plain = shape(buildRail('admin', admin));
    expect(shape(buildRail('admin', admin, null))).toEqual(plain);
    expect(shape(buildRail('admin', admin, {}))).toEqual(plain);
    expect(shape(buildRail('admin', admin, cfg([])))).toEqual(plain);
  });

  it('renames sections and screens, but only to a name that is one', () => {
    const rail = buildRail(
      'admin',
      admin,
      cfg([
        {
          key: 'crm',
          label: 'MRK & REACH',
          items: [
            { id: 'nav-customers', label: 'Prospects' },
            { id: 'nav-deals', label: '' },
          ],
        },
      ]),
    );
    const crm = rail.find(g => g.id === 'crm');
    expect(crm?.label).toBe('MRK & REACH');
    expect(crm?.items.map(i => i.label).slice(0, 2)).toEqual(['Prospects', 'Deals']);
  });

  it('puts sections in the order it lists them, and the ones it does not know after those, in their own order', () => {
    const rail = buildRail(
      'admin',
      admin,
      cfg([
        { key: 'system', items: [] },
        { key: 'crm', items: [] },
      ]),
    );
    expect(rail.map(g => g.id)).toEqual([
      'system',
      'crm',
      'management',
      'finance',
      'logistics',
      'integrations',
      'chat',
      'google',
    ]);
  });

  it('puts screens in the order it lists them, and the ones it does not know at the end of their section', () => {
    const rail = buildRail(
      'admin',
      admin,
      cfg([{ key: 'management', items: [{ id: 'nav-requests' }, { id: 'nav-home' }] }]),
    );
    expect(rail.find(g => g.id === 'management')?.items.map(i => i.id)).toEqual([
      'requests',
      'home',
      'tasks',
      'employees',
      'hours',
      'approvals',
    ]);
  });

  it('moves a screen into another section, as well as within one', () => {
    const rail = buildRail(
      'admin',
      admin,
      cfg([
        {
          key: 'chat',
          items: [
            { id: 'nav-chat' },
            { id: 'nav-whatsapp' },
            { id: 'nav-calendar' },
            { id: 'nav-meet' },
          ],
        },
      ]),
    );
    expect(rail.find(g => g.id === 'chat')?.items.map(i => i.id)).toEqual([
      'chat',
      'whatsapp',
      'calendar',
      'meet',
    ]);
    expect(rail.find(g => g.id === 'google')?.items.map(i => i.id)).toEqual([
      'email',
      'drive',
      'sheets',
    ]);
  });

  it('hides a screen or a section it says to hide', () => {
    const rail = buildRail(
      'admin',
      admin,
      cfg([
        { key: 'management', items: [{ id: 'nav-requests', hidden: true }] },
        { key: 'finance', hidden: true, items: [] },
      ]),
    );
    expect(rail.find(g => g.id === 'management')?.items.map(i => i.id)).not.toContain('requests');
    expect(rail.map(g => g.id)).not.toContain('finance');
  });

  it('draws no heading for a section it has emptied', () => {
    const rail = buildRail(
      'admin',
      admin,
      cfg([
        {
          key: 'system',
          items: [
            { id: 'nav-notif', hidden: true },
            { id: 'nav-workspace', hidden: true },
          ],
        },
      ]),
    );
    expect(rail.map(g => g.id)).not.toContain('system');
  });

  it('ignores what it names that this portal does not have, and what is not a screen at all', () => {
    const team = accessOf(teamMe({ tasks: true }));
    const rail = buildRail(
      'team',
      team,
      cfg([
        {
          key: 'management',
          items: [
            { id: 'nav-employees' },
            { id: 'nav-nonsense' },
            { id: 'nav-tasks' },
            { id: '' },
            {},
          ],
        },
        { key: 'nope', items: [{ id: 'nav-home' }] },
        {},
      ]),
    );
    // (hours and requests are on by default, and the arrangement did not name them: they follow, in their own order)
    expect(rail.find(g => g.id === 'management')?.items.map(i => i.id)).toEqual([
      'tasks',
      'home',
      'hours',
      'requests',
    ]);
  });

  it("reads the admin's words in the team portal: nav-customers is Leads, nav-rfqs is RFQ", () => {
    const team = accessOf(teamMe({ leads: true, rfq: true, contracts: true }));
    const rail = buildRail(
      'team',
      team,
      cfg([
        { key: 'integrations', items: [{ id: 'nav-rfqs' }, { id: 'nav-contracts' }] },
        { key: 'crm', label: 'Sales', items: [{ id: 'nav-customers', label: 'Prospects' }] },
      ]),
    );
    expect(rail.find(g => g.id === 'integrations')?.items.map(i => i.id)).toEqual([
      'rfq',
      'contracts',
    ]);
    expect(rail.find(g => g.id === 'crm')).toMatchObject({
      label: 'Sales',
      items: [{ id: 'leads', label: 'Prospects' }],
    });
  });

  it('can only take screens away: nothing it says opens what a team member may not, or what is not set up', () => {
    const team = accessOf(teamMe({ tasks: true }));
    const wants = cfg([
      { key: 'crm', items: [{ id: 'nav-customers', hidden: false }, { id: 'nav-deals' }] },
      { key: 'google', items: [{ id: 'nav-gchat' }] },
    ]);
    const all = ids(buildRail('team', team, wants)).flat();
    expect(all).not.toContain('leads');
    expect(all).not.toContain('deals');
    expect(all).not.toContain('gchat');
    expect(ids(buildRail('admin', admin, wants)).flat()).not.toContain('gchat');
  });

  it('moves a screen to a section this person has no other screen in, and draws that section', () => {
    const team = accessOf(teamMe({ tasks: true }));
    const rail = buildRail(
      'team',
      team,
      cfg([{ key: 'finance', label: 'Money', items: [{ id: 'nav-tasks' }] }]),
    );
    expect(rail.find(g => g.id === 'finance')).toMatchObject({
      label: 'Money',
      items: [{ id: 'tasks' }],
    });
    expect(rail.find(g => g.id === 'management')?.items.map(i => i.id)).toEqual([
      'home',
      'hours',
      'requests',
    ]);
  });

  it('does not change the shipped rail it started from', () => {
    buildRail(
      'admin',
      admin,
      cfg([{ key: 'crm', label: 'X', items: [{ id: 'nav-customers', label: 'Y', hidden: true }] }]),
    );
    expect(buildRail('admin', admin)[1]?.label).toBe('CRM');
    expect(buildRail('admin', admin)[1]?.items[0]?.label).toBe('Leads');
  });
});

describe('the bottom navigation', () => {
  it('is Home, Tasks, Leads and Chat for the admin, and Home, Tasks, Hours and Requests for the team', () => {
    expect(buildBottomNav('admin', accessOf(adminMe())).map(i => i.id)).toEqual([
      'home',
      'tasks',
      'leads',
      'chat',
    ]);
    expect(
      buildBottomNav(
        'team',
        accessOf(teamMe({ tasks: true, requests: true, hours: true, hoursActions: { log: true } })),
      ).map(i => i.id),
    ).toEqual(['home', 'tasks', 'hours', 'requests']);
  });

  it('shows a team member only the tabs they may open', () => {
    expect(
      buildBottomNav('team', accessOf(teamMe({ tasks: false, requests: true, hours: false }))).map(
        i => i.id,
      ),
    ).toEqual(['home', 'requests']);
  });
});

describe('reading what the server kept as the arrangement', () => {
  it('keeps what is the right shape', () => {
    const raw = {
      groups: [
        {
          key: 'crm',
          label: 'Sales',
          hidden: true,
          items: [{ id: 'nav-deals', label: 'Pipeline', hidden: false }],
        },
      ],
    };
    expect(readNavConfig(raw)).toEqual({
      groups: [
        {
          key: 'crm',
          label: 'Sales',
          hidden: true,
          items: [{ id: 'nav-deals', label: 'Pipeline', hidden: false }],
        },
      ],
    });
  });

  it('leaves out what is not: nothing in a saved arrangement can fail the rail', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}, { groups: 'x' }, { groups: {} }])
      expect(readNavConfig(raw)).toEqual({});
    const messy = readNavConfig({
      groups: [
        null,
        7,
        'x',
        [],
        { key: 5, label: {}, hidden: 'yes', items: 'nope' },
        { key: 'crm', items: [null, { id: 3 }, { id: 'nav-deals', label: 9 }] },
      ],
    });
    expect(messy.groups).toEqual([
      { hidden: false, items: [] },
      { key: 'crm', hidden: false, items: [{ hidden: false }, { id: 'nav-deals', hidden: false }] },
    ]);
    expect(buildRail('admin', accessOf(adminMe()), messy).length).toBeGreaterThan(0);
  });

  it('hides only when it says true, not when it says anything else that is truthy', () => {
    const c = readNavConfig({
      groups: [{ key: 'crm', hidden: 'true', items: [{ id: 'nav-deals', hidden: 1 }] }],
    });
    expect(c.groups?.[0]?.hidden).toBe(false);
    expect(c.groups?.[0]?.items?.[0]?.hidden).toBe(false);
  });
});
