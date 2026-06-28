import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { uploadFile } from './storage.service.js';
import { env } from '../config/env.js';

const INR = (n) => 'Rs. ' + Number(n || 0).toFixed(2);

/**
 * Render a professional A5 invoice PDF into a Buffer.
 * invoice: full invoice record + items + shop + staff + customer.
 */
export async function buildInvoicePdf(invoice) {
  const {
    shop = {},
    items = [],
    staffName,
    customer,
    invoice_number,
    payment_mode,
    payment_split = {},
    subtotal,
    discount,
    tax_pct,
    tax_amount,
    total,
    created_at,
  } = invoice;

  const qrPayload = JSON.stringify({
    inv: invoice_number,
    total,
    date: created_at,
    shop: shop.name,
  });
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 120 });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 28 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 56;

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(shop.name || 'RK Garments', { align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('#555');
    if (shop.address) doc.text(shop.address, { align: 'center' });
    const line2 = [shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
    if (line2) doc.text(line2, { align: 'center' });
    if (shop.phone) doc.text(`Ph: ${shop.phone}`, { align: 'center' });
    if (shop.is_gst_enabled && shop.gstin) doc.text(`GSTIN: ${shop.gstin}`, { align: 'center' });

    doc.moveDown(0.4).fillColor('#000');
    doc.moveTo(28, doc.y).lineTo(doc.page.width - 28, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.4);

    // Invoice meta
    const metaY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').text(`Invoice: ${invoice_number}`, 28, metaY);
    doc.font('Helvetica').text(
      `Date: ${new Date(created_at).toLocaleString('en-IN')}`,
      28,
      metaY + 12,
    );
    doc.text(`Staff: ${staffName || '-'}`, 28, metaY + 24);
    if (customer?.name) doc.text(`Customer: ${customer.name}`, 28, metaY + 36);

    // QR top-right
    doc.image(qrBuffer, doc.page.width - 28 - 70, metaY, { width: 70 });
    doc.moveDown(customer?.name ? 4 : 3.5);

    // Table header
    const cols = { name: 28, qty: 220, rate: 270, amt: 340 };
    const headerY = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Item', cols.name, headerY);
    doc.text('Qty', cols.qty, headerY);
    doc.text('Rate', cols.rate, headerY);
    doc.text('Amount', cols.amt, headerY, { width: pageWidth - cols.amt + 28, align: 'right' });
    doc.moveTo(28, headerY + 12).lineTo(doc.page.width - 28, headerY + 12).strokeColor('#ccc').stroke();

    // Rows
    doc.font('Helvetica').fontSize(8);
    let y = headerY + 16;
    for (const it of items) {
      const label = `${it.product_name}${it.size ? ' / ' + it.size : ''}${it.color ? ' / ' + it.color : ''}`;
      doc.text(label, cols.name, y, { width: cols.qty - cols.name - 4 });
      doc.text(String(it.quantity), cols.qty, y);
      doc.text(INR(it.selling_price), cols.rate, y);
      doc.text(INR(it.line_total), cols.amt, y, { width: pageWidth - cols.amt + 28, align: 'right' });
      y += Math.max(14, doc.heightOfString(label, { width: cols.qty - cols.name - 4 }));
    }

    doc.moveTo(28, y + 2).lineTo(doc.page.width - 28, y + 2).strokeColor('#ccc').stroke();
    y += 8;

    // Totals
    const totalsX = 250;
    const rightW = doc.page.width - 28 - totalsX;
    const totalLine = (label, val, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8);
      doc.text(label, totalsX, y, { width: 60 });
      doc.text(val, totalsX + 60, y, { width: rightW - 60, align: 'right' });
      y += bold ? 16 : 13;
    };
    totalLine('Subtotal', INR(subtotal));
    if (Number(discount) > 0) totalLine('Discount', '- ' + INR(discount));
    if (Number(tax_amount) > 0) totalLine(`Tax (${tax_pct}%)`, INR(tax_amount));
    totalLine('TOTAL', INR(total), true);

    // Payment
    y += 4;
    doc.font('Helvetica').fontSize(8);
    let payText = `Payment: ${String(payment_mode).toUpperCase()}`;
    if (payment_mode === 'mixed') {
      const parts = Object.entries(payment_split)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => `${k}: ${INR(v)}`)
        .join('  ');
      payText += `  (${parts})`;
    }
    doc.text(payText, 28, y);
    y += 18;

    // Footer
    const footer = shop?.settings?.invoice?.footer || 'Thank you for shopping with us!';
    doc.fontSize(8).fillColor('#555').text(footer, 28, y, { align: 'center', width: pageWidth });

    doc.end();
  });
}

/** Build PDF and persist it to Supabase Storage. Returns { path, url, buffer }. */
export async function generateAndStoreInvoicePdf(invoice) {
  const buffer = await buildInvoicePdf(invoice);
  const path = `${invoice.shop_id}/${invoice.invoice_number}.pdf`;
  const { url } = await uploadFile(buffer, {
    bucket: env.buckets.invoices,
    path,
    contentType: 'application/pdf',
  });
  return { path, url, buffer };
}
