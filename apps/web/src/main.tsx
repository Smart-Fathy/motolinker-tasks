import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The sheets first, and in this order: base.css opens by declaring the layers (reset, base, ui), and the layers rank
// in the order they are first named in the built stylesheet — which is the order these imports come in. Import a
// component before it and `ui` is named first and ranks lowest, under the reset.
import './styles/base.css';
import './styles/portal-team.css';
import { App } from './app/App';
import { takeArrival } from './lib/arrival';
import { readEnv } from './lib/env';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');
const env = readEnv();
// Once, before anything renders: a Google return or a reset link is read and taken out of the address bar here, not
// in a component that StrictMode may run twice.
const arrival = takeArrival(env.portal);
createRoot(root).render(
  <StrictMode>
    <App env={env} arrival={arrival} />
  </StrictMode>,
);
