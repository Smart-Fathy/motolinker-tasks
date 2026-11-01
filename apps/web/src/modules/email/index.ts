import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('email', { Page: lazyPage(() => import('./Email'), 'Email') });
