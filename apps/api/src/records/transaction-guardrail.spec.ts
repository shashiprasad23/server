import { assertNoTransactionData, containsCardNumber, findTransactionData, isForbiddenKey, redactCardNumbers, stripTransactionData } from './transaction-guardrail';

describe('transaction guardrail (FR-NS-02)', () => {
  it.each(['invoice_amount', 'invoiceNumber', 'payment_details', 'amount_paid', 'line_items', 'order_lines', 'card_number', 'iban', 'bank_account', 'credit_memo'])(
    'rejects %s',
    (k) => expect(isForbiddenKey(k)).toBe(true),
  );

  it.each(['netsuite_sales_order_id', 'netsuite_status', 'order_reference', 'expected_value', 'gpu_count', 'routed_to'])('allows %s', (k) =>
    expect(isForbiddenKey(k)).toBe(false),
  );

  it('finds nested transaction keys and card numbers', () => {
    expect(findTransactionData({ custom: { invoice_total: 10 }, notes: 'card 4111 1111 1111 1111' })).toEqual(['custom.invoice_total', 'notes']);
    expect(() => assertNoTransactionData({ name: 'ok', owner_id: '00000000-0000-0000-0001-000000000003' })).not.toThrow();
  });

  it('does not mistake UUIDs, dates or quantities for cards', () => {
    expect(containsCardNumber('00000000-0000-0000-0001-000000000003')).toBe(false);
    expect(containsCardNumber('64 H200 GPUs by 2027-03-31, PO 4500012345')).toBe(false);
  });

  it('redacts and strips inbound payloads instead of storing them', () => {
    expect(redactCardNumbers('use 4111-1111-1111-1111')).toBe('use [redacted: payment card]');
    expect(stripTransactionData({ order_reference: 'MP-1', payment: { method: 'card' }, items: [{ sku: 'X', line_items: [] }] })).toEqual({
      order_reference: 'MP-1',
      items: [{ sku: 'X' }],
    });
  });
});
