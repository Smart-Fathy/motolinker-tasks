import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('calendar', { Page: lazyPage(() => import('./Calendar'), 'Calendar') });
