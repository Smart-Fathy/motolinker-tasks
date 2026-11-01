import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The sheets first, and in this order: base.css opens by declaring the layers (reset, base, ui), and the layers rank
// in the order they are first named in the built stylesheet — which is the order these imports come in. Import a
// component before it and `ui` is named first and ranks lowest, under the reset.
import './styles/base.css';
import './styles/portal-team.css';
import { App } from './app/App';
import { takeArrival } from './lib/arrival';
import { takeChatReturn } from './lib/chat-return';
import { readEnv } from './lib/env';
import { reloadOnStaleChunk, startWorker } from './lib/pwa';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');
const env = readEnv();
// Once, before anything renders: a Google return or a reset link is read and taken out of the address bar here, not
// in a component that StrictMode may run twice.
const arrival = takeArrival(env.portal);
// …and so is the reason Google Chat's consent screen sent someone back with, for either portal.
takeChatReturn();
// The app's worker keeps its first load for a start without a network; a page the server did not send (the dev server) has none.
if (env.ui === 'next') startWorker(env.portal);
reloadOnStaleChunk();
createRoot(root).render(
  <StrictMode>
    <App env={env} arrival={arrival} />
  </StrictMode>,
);
