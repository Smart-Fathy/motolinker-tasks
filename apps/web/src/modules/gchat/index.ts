import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('gchat', { Page: lazyPage(() => import('./Gchat'), 'Gchat') });
