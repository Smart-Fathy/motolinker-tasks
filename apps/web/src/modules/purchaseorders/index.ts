import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('purchaseorders', { Page: lazyPage(() => import('./Pos'), 'Pos') });
