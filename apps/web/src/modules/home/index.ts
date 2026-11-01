import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('home', { Page: lazyPage(() => import('./Home'), 'Home') });
