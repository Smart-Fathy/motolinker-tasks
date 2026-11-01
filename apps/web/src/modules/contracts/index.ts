import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('contracts', {
  Page: lazyPage(() => import('./Contracts'), 'Contracts'),
});
