import fs from 'node:fs';
import PDFDocument from 'pdfkit';

const UNICODE_FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => fs.existsSync(f));

/** Renders a branded quote PDF in memory. */
export function renderQuotePdf(q: any): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    compress: false,
    info: { Title: `Quote ${q.number}` },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  if (UNICODE_FONT) doc.font(UNICODE_FONT);
  const money = (n: number) => `${q.currency} ${n.toFixed(2)}`;

  doc.fontSize(20).text('UVATION', { continued: false });
  doc.fontSize(9).text('Uvation Marketplace | quotes@uvation.com | +1 (888) 555-0100 | www.uvation.com');
  doc.moveDown();
  doc.fontSize(14).text(`Quote ${q.number}  Revision ${q.revision}`);
  doc
    .fontSize(10)
    .text(
      `Status: ${q.status}   Date: ${q.createdAt.slice(0, 10)}   Valid until: ${q.terms.validUntil.slice(0, 10)}`,
    );
  doc.text(`Customer: ${q.customer.companyName ?? ''} ${q.customer.contactName ?? ''} <${q.customer.email}>`);
  doc.moveDown();
  doc.fontSize(11).text('Line items');
  doc.fontSize(9);
  for (const l of q.items) {
    doc.text(
      `${l.name} | SKU ${l.sku} | Qty ${l.quantity} | Unit ${money(l.unitPrice)} | Total ${money(l.lineTotal)}`,
    );
    doc.text(`   ${l.description}`);
    if (l.configuration) doc.text(`   Config: ${JSON.stringify(l.configuration)}`);
    if (l.recurring)
      doc.text(
        `   Recurring: ${money(l.unitPrice)}/${l.recurring.period} for ${l.recurring.termMonths} months, deposit ${money(l.recurring.deposit)}`,
      );
  }
  doc.moveDown();
  doc.fontSize(10);
  doc.text(`Subtotal: ${money(q.subtotal)}`);
  doc.text(`Discount: ${money(q.discountTotal)}`);
  doc.text(`Tax: ${money(q.taxTotal)}`);
  doc.text(`Shipping: ${money(q.shippingTotal)}`);
  doc.text(`Grand total: ${money(q.grandTotal)}`);
  doc.moveDown();
  doc.fontSize(11).text('Commercial terms');
  doc.fontSize(9);
  doc.text(`Payment terms: ${q.terms.paymentTerms}`);
  doc.text(`Delivery estimate: ${q.terms.deliveryEstimate}`);
  doc.text(`Warranty: ${q.terms.warranty}`);
  doc.text(`Validity: valid until ${q.terms.validUntil.slice(0, 10)}`);
  doc.text(`Taxes: ${q.taxTotal > 0 ? 'Sales tax included as shown' : 'No tax applicable'}`);
  doc.text(`Exclusions: ${q.terms.exclusions}`);
  doc.end();
  return done;
}
