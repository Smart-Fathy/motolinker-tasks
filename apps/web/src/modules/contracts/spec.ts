import {
  isContract,
  isContractDefaults,
  isContractList,
  type Contract,
  type ContractDefaults,
  type ContractRow,
} from '../../docs/model';
import type { DocSpec } from '../../docs/data';

/** What the contracts screen asks of the server, and how it reads the answers. */
export const CONTRACT_SPEC: DocSpec<ContractRow, Contract, ContractDefaults> = {
  key: 'contract',
  path: 'contracts',
  noun: 'contract',
  isList: isContractList,
  isOne: isContract,
  isDefaults: isContractDefaults,
};
