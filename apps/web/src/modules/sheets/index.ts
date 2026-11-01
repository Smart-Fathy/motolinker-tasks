import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('sheets', { Page: lazyPage(() => import('./Sheets'), 'Sheets') });
