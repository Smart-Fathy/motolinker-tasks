import {
  isRfq,
  isRfqDefaults,
  isRfqList,
  type Rfq,
  type RfqDefaults,
  type RfqRow,
} from '../../docs/model';
import type { DocSpec } from '../../docs/data';

/** What the RFQ screen asks of the server, and how it reads the answers. */
export const RFQ_SPEC: DocSpec<RfqRow, Rfq, RfqDefaults> = {
  key: 'rfq',
  path: 'rfqs',
  noun: 'RFQ',
  isList: isRfqList,
  isOne: isRfq,
  isDefaults: isRfqDefaults,
};
