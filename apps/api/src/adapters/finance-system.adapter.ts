/**
 * FR-NS-03: the one seam between ATLAS-I and the finance system of record (Oracle NetSuite).
 * During the internal phase the stub is bound and Finance records NetSuite IDs by hand (FR-NS-04);
 * after month 6 a SuiteTalk REST / RESTlet implementation replaces it without CRM data-model changes.
 * Note what is absent: no method returns invoice amounts, order lines or payments (FR-NS-01).
 */
export interface FinanceCustomerRef {
  netsuiteCustomerId: string;
  creditHold: boolean;
}

export type NetSuiteStatus = 'open' | 'fulfilled' | 'billed' | 'paid' | 'overdue' | 'settled';

export interface FinanceItem {
  sku: string;
  description: string;
  standardCost: number | null;
  stockByLocation: Record<string, number>;
}

export interface CloseRequest {
  opportunityId: string;
  accountId: string;
  netsuiteCustomerId?: string | null;
  customerPoReference: string;
  /** Approved quote id; the quote stays a pre-sale proposal in ATLAS-I. */
  quoteId: string;
}

export interface FinanceSystemAdapter {
  readonly name: string;
  readonly connected: boolean;
  /** Create or find the financial customer record. */
  upsertCustomer(accountId: string, name: string, domain?: string | null): Promise<FinanceCustomerRef | null>;
  /** Create the sales order from an accepted quote; returns the NetSuite sales order id. */
  createSalesOrder(req: CloseRequest): Promise<{ salesOrderId: string } | null>;
  /** Status flag only, never amounts. */
  salesOrderStatus(salesOrderId: string): Promise<NetSuiteStatus | null>;
  items(skus: string[]): Promise<FinanceItem[]>;
}

export const FINANCE_SYSTEM = Symbol('FINANCE_SYSTEM');

/** Bound until the NetSuite integration ships: reports "not connected" so callers fall back to the manual close flow. */
export class ManualFinanceSystem implements FinanceSystemAdapter {
  readonly name = 'manual (NetSuite not connected)';
  readonly connected = false;
  async upsertCustomer() {
    return null;
  }
  async createSalesOrder() {
    return null;
  }
  async salesOrderStatus() {
    return null;
  }
  async items() {
    return [];
  }
}
