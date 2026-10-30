import ThemeCore from '@theme-core';
import { useEffect, useMemo, useState } from 'react';
import type { Portal } from '../lib/env';
import { MODES, Theme, type Mode } from '../lib/theme';
import { Alert, AuthLayout, Button, ButtonLink, Field, LinkButton } from '../ui';
import styles from './gallery.module.css';
import { Specimen } from './Specimen';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

const SWATCHES = [
  '--bg',
  '--surface',
  '--card',
  '--primary',
  '--text',
  '--muted',
  '--danger',
  '--success',
  '--warning',
] as const;

/**
 * The design system on one page: every primitive, the frame, and the colours, under any look the workspace can have. Pick
 * the portal, the look and the mode and the page wears them through the same runtime the app does — the contrast audit
 * (tests/galleryaudit.js) goes round all of them and holds every text to its floor.
 */
export default function Gallery({ portal: start = 'admin' }: { portal?: Portal }) {
  const [portal, setPortal] = useState<Portal>(start);
  const [preset, setPreset] = useState<string>(ThemeCore.DEFAULT_PRESET);
  const [mode, setMode] = useState<Mode>('dark');
  // (its own storage: looking at the gallery never changes the colour a person chose for the app)
  const theme = useMemo(
    () => new Theme({ storage: memory(), initial: { name: 'Acme Motors', texts: {} } }),
    [],
  );

  useEffect(() => {
    document.documentElement.dataset['portal'] = portal;
  }, [portal]);
  useEffect(() => {
    // each look is newer than the one before, so the runtime wears it (it ignores a profile older than the one it wears)
    const stamp = new Date(Date.UTC(2030, 0, 1, 0, 0, 0) + (Date.now() % 1e9)).toISOString();
    theme.apply({
      name: 'Acme Motors',
      logo_url: '',
      updated_at: stamp,
      theme: { preset, allow_user_mode: true },
      typography: {},
      shape: {},
      texts: {},
    });
    theme.setMode(mode);
  }, [theme, preset, mode]);

  return (
    <div className={styles['gallery']} data-part="gallery">
      <header className={styles['bar']}>
        <h1 className={styles['title']}>Gallery</h1>
        <label className={styles['control']}>
          Portal
          <select
            name="portal"
            value={portal}
            onChange={e => setPortal(e.target.value === 'team' ? 'team' : 'admin')}
          >
            <option value="admin">Admin</option>
            <option value="team">Team</option>
          </select>
        </label>
        <label className={styles['control']}>
          Look
          <select name="preset" value={preset} onChange={e => setPreset(e.target.value)}>
            {ThemeCore.PRESET_ORDER.map(id => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['control']}>
          Mode
          <select
            name="mode"
            value={mode}
            onChange={e => setMode(MODES.find(m => m === e.target.value) ?? 'dark')}
          >
            {MODES.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className={styles['section']} data-section="colours">
        <h2>Colours</h2>
        <div className={styles['swatches']}>
          {SWATCHES.map(token => (
            <div key={token} className={styles['swatch']} style={{ background: `var(${token})` }}>
              <span className={styles['swatchName']}>{token}</span>
            </div>
          ))}
        </div>
        <p>Body text on the page.</p>
        <p className="muted">Secondary text on the page.</p>
        <a href="#gallery">A link</a>
      </section>

      <section className={styles['section']} data-section="buttons">
        <h2>Buttons</h2>
        <div className={styles['row']}>
          <Button>Primary</Button>
          <Button look="outline">Outline</Button>
          <Button busy>Busy</Button>
          <Button disabled>Disabled</Button>
          <ButtonLink href="#gallery">A link that looks like a button</ButtonLink>
          <LinkButton>A line of muted text</LinkButton>
        </div>
      </section>

      <section className={styles['section']} data-section="fields">
        <h2>Fields and messages</h2>
        <div className={styles['narrow']}>
          <Field label="Username" name="username" placeholder="Username" defaultValue="" />
          <Field
            label="Password"
            name="password"
            type="password"
            placeholder="Password"
            defaultValue=""
          />
          <Alert>That did not work: the password is not right.</Alert>
          <Alert tone="success">Done: a link is on its way.</Alert>
        </div>
      </section>

      <section className={styles['section']} data-section="sign-in">
        <h2>The sign-in card</h2>
        <div className={styles['framed']}>
          <AuthLayout portal={portal} title="Sign in" subtitle="Use your workspace account">
            <Field
              label="Username"
              name="gallery-username"
              placeholder="Username"
              defaultValue=""
            />
            <Button full>Sign In</Button>
          </AuthLayout>
        </div>
      </section>

      <section className={styles['section']} data-section="frame">
        <h2>The frame</h2>
        <Specimen portal={portal} theme={theme} />
      </section>
    </div>
  );
}
