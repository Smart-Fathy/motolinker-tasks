import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('rfq', { Page: lazyPage(() => import('./Rfqs'), 'Rfqs') });
