import {
  isPo,
  isPoDefaults,
  isPoList,
  type Po,
  type PoDefaults,
  type PoRow,
} from '../../docs/model';
import type { DocSpec } from '../../docs/data';

/** What the purchase-order screen asks of the server, and how it reads the answers. */
export const PO_SPEC: DocSpec<PoRow, Po, PoDefaults> = {
  key: 'po',
  path: 'purchase-orders',
  noun: 'purchase order',
  isList: isPoList,
  isOne: isPo,
  isDefaults: isPoDefaults,
};
