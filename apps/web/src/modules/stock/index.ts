import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('stock', { Page: lazyPage(() => import('./Stock'), 'Stock') });
