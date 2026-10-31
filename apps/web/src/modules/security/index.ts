import { defineModule } from '../../app/define-module';
import { SecurityRoute } from './SecurityRoute';

export default defineModule('security', { Page: SecurityRoute });

// What the frame of the app (the profile menu, the admin's footer) takes from this module: the panel it opens, and — for the
// team portal's account menu — the dialogs that change what a person keeps about themselves.
export { SecurityPanel } from './SecurityPanel';
export { AccountDialogs } from './AccountDialogs';
export { useAccount } from './account';
