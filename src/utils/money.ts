export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Recomputes the expected totals from the quote's own lines so the API's arithmetic can be cross-checked. */
export function expectedTotals(
  lines: { lineTotal: number; taxable: boolean }[],
  discountPercent: number,
  taxRatePercent: number,
  shipping: number,
) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discountTotal = round2((subtotal * discountPercent) / 100);
  const taxableGross = lines.filter((l) => l.taxable).reduce((s, l) => s + l.lineTotal, 0);
  const taxableBase = round2(taxableGross * (1 - discountPercent / 100));
  const taxTotal = round2((taxableBase * taxRatePercent) / 100);
  const grandTotal = round2(subtotal - discountTotal + taxTotal + shipping);
  return { subtotal, discountTotal, taxableBase, taxTotal, shippingTotal: shipping, grandTotal };
}
