import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('submissions', {
  Page: lazyPage(() => import('./Submissions'), 'Submissions'),
});
