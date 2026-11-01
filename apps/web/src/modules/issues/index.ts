import { defineModule, lazyPage } from '../../app/define-module';

export default defineModule('issues', { Page: lazyPage(() => import('./Issues'), 'Issues') });

// What the frame of the app (the sidebar's footer and the profile menu) takes from this module.
export { ReportIssue } from './ReportIssue';
