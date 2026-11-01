import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('security', {
  Page: lazyPage(() => import('./SecurityRoute'), 'SecurityRoute'),
});

// What the frame of the app (the profile menu, the admin's footer) takes from this module: the panel it opens, and — for the
// team portal's account menu — the dialogs that change what a person keeps about themselves.
export { SecurityPanel } from './SecurityPanel';
export { AccountDialogs } from './AccountDialogs';
export { useAccount } from './account';
