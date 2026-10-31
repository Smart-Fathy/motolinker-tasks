import { defineModule } from '../../app/define-module';
import { Suppliers } from './Suppliers';

export default defineModule('suppliers', { Page: Suppliers });

// What the document screens (RFQs, purchase orders) take from this module: the register, to pick a supplier from, and the
// catalogue, to pull a line from.
export { useSupplierList } from './data';
export { isOfferList, type Offer, type Supplier } from './model';
