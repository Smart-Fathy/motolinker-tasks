import { defineModule } from '../../app/define-module';
import { Issues } from './Issues';

export default defineModule('issues', { Page: Issues });

// What the frame of the app (the sidebar's footer and the profile menu) takes from this module.
export { ReportIssue } from './ReportIssue';
