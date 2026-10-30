import { SCREENS } from '@motolinker/contracts/modules';
import { describe, expect, it } from 'vitest';
import { defineModule } from './define-module';
import { registry, registryFrom } from './registry';

const Page = () => null;

describe('defineModule', () => {
  it('makes a module of a screen in the catalogue', () => {
    const m = defineModule('leads', { Page });
    expect(m.id).toBe('leads');
    expect(m.Page).toBe(Page);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('refuses a name that is not a screen: a typo is an error when the app starts, not a link that goes nowhere', () => {
    expect(() => defineModule('lead', { Page })).toThrow(/"lead" is not a screen in the catalogue/);
    expect(() => defineModule('', { Page })).toThrow();
  });
});

describe('the registry', () => {
  it('is whatever modules/<id>/index.ts files there are, keyed by id', () => {
    const a = defineModule('leads', { Page });
    const b = defineModule('deals', { Page });
    const r = registryFrom({
      '../modules/leads/index.ts': { default: a },
      '../modules/deals/index.ts': { default: b },
    });
    expect([...r.keys()].sort()).toEqual(['deals', 'leads']);
    expect(r.get('leads')).toBe(a);
  });

  it('refuses a module that is not in the directory of its own id, so it cannot register under the wrong name', () => {
    const a = defineModule('leads', { Page });
    expect(() => registryFrom({ '../modules/deals/index.ts': { default: a } })).toThrow(
      /directory of its own id/,
    );
  });

  it('refuses a file that does not default-export a module', () => {
    expect(() => registryFrom({ '../modules/leads/index.ts': {} })).toThrow(
      /must default-export defineModule/,
    );
  });

  it('refuses a file that is not under modules/<id>/', () => {
    const a = defineModule('leads', { Page });
    expect(() => registryFrom({ '../elsewhere/leads.ts': { default: a } })).toThrow(
      /must default-export defineModule/,
    );
  });

  it('finds, in this app, the modules that have moved: Calendar, Home, Issues, Meet, Notifications and Submissions so far', () => {
    expect([...registry.keys()].sort()).toEqual([
      'calendar',
      'home',
      'issues',
      'meet',
      'notifications',
      'submissions',
    ]);
  });

  it('has a module for every screen that is new to a portal: the classic portal has no page for a frame to show', () => {
    const fresh = SCREENS.filter(s => 'fresh' in s);
    expect(fresh.map(s => s.id)).toContain('issues');
    expect(fresh.filter(s => !registry.has(s.id)).map(s => s.id)).toEqual([]);
  });
});
