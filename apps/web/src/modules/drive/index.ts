import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('drive', { Page: lazyPage(() => import('./Drive'), 'Drive') });
