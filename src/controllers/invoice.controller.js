import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, notFound, badRequest, forbidden } from '../utils/errors.js';
import { ok, created, parseListQuery, buildMeta } from '../utils/response.js';
import { generateAndStoreInvoicePdf } from '../services/pdf.service.js';
import { logAudit } from '../services/audit.service.js';
import { notify } from '../services/notification.service.js';
import { env } from '../config/env.js';

/** Generate the next invoice number using shop settings (atomic-ish). */
async function nextInvoiceNumber(shopId) {
  const { data: setting } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('shop_id', shopId)
    .eq('key', 'invoice')
    .maybeSingle();

  const cfg = setting?.value || { prefix: 'RK', next_number: 1 };
  const number = cfg.next_number || 1;
  const prefix = cfg.prefix || 'RK';
  const formatted = `${prefix}-${String(number).padStart(6, '0')}`;

  await supabaseAdmin
    .from('settings')
    .upsert(
      { shop_id: shopId, key: 'invoice', value: { ...cfg, next_number: number + 1 } },
      { onConflict: 'shop_id,key' },
    );

  return formatted;
}

/**
 * Create an invoice (the heart of the POS).
 * - Validates selling >= purchase for each item
 * - Inserts invoice + items (DB triggers reduce stock, mark sold, compute lines)
 * - Rolls up totals + customer lifetime
 * - Generates & stores PDF in Supabase Storage
 * - Emits realtime notification + audit log
 */
export const createInvoice = asyncHandler(async (req, res) => {
  const {
    items = [],
    customer_id = null,
    payment_mode = 'cash',
    payment_split = {},
    discount = 0,
    tax_pct = 0,
    notes = null,
    printer_available = true,
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('At least one item is required');
  }

  // Validate selling >= purchase up front (defence in depth; DB also enforces)
  for (const it of items) {
    if (Number(it.selling_price) < Number(it.purchase_price)) {
      throw badRequest(`Selling price below purchase price for ${it.product_code}`);
    }
    if (!it.quantity || Number(it.quantity) <= 0) {
      throw badRequest(`Invalid quantity for ${it.product_code}`);
    }
  }

  const invoiceNumber = await nextInvoiceNumber(req.user.shop_id);
  const status = printer_available ? 'completed' : 'pending_print';

  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      shop_id: req.user.shop_id,
      branch_id: req.user.branch_id,
      invoice_number: invoiceNumber,
      customer_id,
      staff_id: req.user.id,
      payment_mode,
      payment_split,
      discount: Number(discount) || 0,
      tax_pct: Number(tax_pct) || 0,
      status,
      notes,
    })
    .select()
    .single();
  if (invErr) throw invErr;

  // Insert items (triggers: guard price, compute line totals, decrement stock)
  const itemRows = items.map((it) => ({
    invoice_id: invoice.id,
    product_id: it.product_id || null,
    product_code: it.product_code,
    product_name: it.product_name,
    product_image: it.product_image || null,
    category: it.category || null,
    brand: it.brand || null,
    color: it.color || null,
    size: it.size || null,
    quantity: Number(it.quantity),
    purchase_price: Number(it.purchase_price),
    selling_price: Number(it.selling_price),
  }));

  const { error: itemsErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
  if (itemsErr) {
    // best-effort rollback of the invoice header
    await supabaseAdmin.from('invoices').delete().eq('id', invoice.id);
    throw badRequest(itemsErr.message);
  }

  // Roll up totals + customer lifetime via DB function
  await supabaseAdmin.rpc('rollup_invoice_totals', { p_invoice: invoice.id });

  // Re-fetch full invoice for PDF
  const full = await fetchFullInvoice(invoice.id, req.user.shop_id);

  // Generate & store PDF
  let pdf = null;
  try {
    pdf = await generateAndStoreInvoicePdf(full);
    await supabaseAdmin
      .from('invoices')
      .update({ pdf_url: pdf.url, pdf_path: pdf.path })
      .eq('id', invoice.id);
    full.pdf_url = pdf.url;
    full.pdf_path = pdf.path;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[invoice] PDF generation failed:', e.message);
  }

  // Realtime notification + high value alert
  await notify({
    shopId: req.user.shop_id,
    type: 'sale_created',
    title: `Sale ${invoiceNumber}`,
    message: `${full.staffName} sold ${items.length} item(s) for Rs.${full.total}`,
    data: {
      invoice_number: invoiceNumber,
      total: full.total,
      profit: full.total_profit,
      payment_mode,
      staff: full.staffName,
      items: itemRows.map((i) => ({ name: i.product_name, image: i.product_image, qty: i.quantity, price: i.selling_price })),
    },
  });

  if (Number(full.total) >= env.highValueThreshold) {
    await notify({
      shopId: req.user.shop_id,
      type: 'high_value_sale',
      title: 'High value sale',
      message: `${invoiceNumber} totalling Rs.${full.total}`,
      data: { invoice_number: invoiceNumber, total: full.total },
    });
  }

  // Low stock alerts
  await checkLowStock(req, itemRows);

  await logAudit({
    req,
    action: 'create_invoice',
    entityType: 'invoice',
    entityId: invoice.id,
    invoiceNumber,
    metadata: { total: full.total, payment_mode, items: itemRows.length },
  });

  return created(res, full);
});

async function checkLowStock(req, items) {
  const ids = items.map((i) => i.product_id).filter(Boolean);
  if (!ids.length) return;
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, name, stock, reorder_level')
    .in('id', ids);
  for (const p of data || []) {
    if (p.stock <= p.reorder_level) {
      await notify({
        shopId: req.user.shop_id,
        type: 'low_stock',
        title: 'Low stock',
        message: `${p.name} has only ${p.stock} left`,
        data: { product_id: p.id, stock: p.stock },
      });
    }
  }
}

/** Build the fully-populated invoice object (shop, items, names). */
async function fetchFullInvoice(invoiceId, shopId) {
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('shop_id', shopId)
    .single();

  const { data: items } = await supabaseAdmin
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId);

  const { data: shop } = await supabaseAdmin.from('shops').select('*').eq('id', shopId).single();

  let staffName = null;
  if (invoice.staff_id) {
    const { data: staff } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', invoice.staff_id)
      .maybeSingle();
    staffName = staff?.full_name;
  }

  let customer = null;
  if (invoice.customer_id) {
    const { data: c } = await supabaseAdmin
      .from('customers')
      .select('name, phone')
      .eq('id', invoice.customer_id)
      .maybeSingle();
    customer = c;
  }

  return { ...invoice, items: items || [], shop, staffName, customer };
}

export const listInvoices = asyncHandler(async (req, res) => {
  const q = parseListQuery(req.query);
  let query = supabaseAdmin
    .from('invoices')
    .select('*, staff:profiles(full_name), customer:customers(name, phone)', { count: 'exact' })
    .eq('shop_id', req.user.shop_id)
    .eq('is_deleted', false);

  if (q.search) query = query.ilike('invoice_number', `%${q.search}%`);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.payment_mode) query = query.eq('payment_mode', req.query.payment_mode);
  if (req.query.staff_id) query = query.eq('staff_id', req.query.staff_id);
  if (req.query.from) query = query.gte('created_at', req.query.from);
  if (req.query.to) query = query.lte('created_at', req.query.to);

  // Staff can only see their own invoices
  if (req.user.role === 'staff') query = query.eq('staff_id', req.user.id);

  query = query.order(q.sort, { ascending: q.order === 'asc' }).range(q.from, q.to);
  const { data, error, count } = await query;
  if (error) throw error;
  return ok(res, data, buildMeta({ page: q.page, limit: q.limit, count }));
});

export const getInvoice = asyncHandler(async (req, res) => {
  const full = await fetchFullInvoice(req.params.id, req.user.shop_id);
  if (!full?.id) throw notFound('Invoice not found');
  if (req.user.role === 'staff' && full.staff_id !== req.user.id) throw forbidden();
  return ok(res, full);
});

/** Regenerate / fetch PDF and mark printed. Used for reprint + pending print. */
export const reprintInvoice = asyncHandler(async (req, res) => {
  const full = await fetchFullInvoice(req.params.id, req.user.shop_id);
  if (!full?.id) throw notFound('Invoice not found');

  let pdfUrl = full.pdf_url;
  if (!pdfUrl) {
    const pdf = await generateAndStoreInvoicePdf(full);
    pdfUrl = pdf.url;
    await supabaseAdmin
      .from('invoices')
      .update({ pdf_url: pdf.url, pdf_path: pdf.path, status: 'completed' })
      .eq('id', full.id);
  } else if (full.status === 'pending_print') {
    await supabaseAdmin.from('invoices').update({ status: 'completed' }).eq('id', full.id);
  }

  await logAudit({ req, action: 'reprint_invoice', entityType: 'invoice', entityId: full.id, invoiceNumber: full.invoice_number });
  return ok(res, { pdf_url: pdfUrl, invoice_number: full.invoice_number });
});

/**
 * Cancel an invoice. Completed invoices may only be cancelled by admin
 * (fraud prevention). Restores stock.
 */
export const cancelInvoice = asyncHandler(async (req, res) => {
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', req.params.id)
    .eq('shop_id', req.user.shop_id)
    .single();
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'completed' && req.user.role !== 'admin') {
    throw forbidden('Only admin can cancel a completed invoice');
  }

  const { data: items } = await supabaseAdmin
    .from('invoice_items')
    .select('product_id, quantity')
    .eq('invoice_id', invoice.id);

  for (const it of items || []) {
    if (!it.product_id) continue;
    const { data: p } = await supabaseAdmin.from('products').select('stock').eq('id', it.product_id).single();
    const before = p?.stock ?? 0;
    await supabaseAdmin
      .from('products')
      .update({ stock: before + it.quantity, status: 'available' })
      .eq('id', it.product_id);
    await supabaseAdmin.from('stock_movements').insert({
      shop_id: req.user.shop_id,
      product_id: it.product_id,
      type: 'return',
      quantity: it.quantity,
      stock_before: before,
      stock_after: before + it.quantity,
      reference_id: invoice.id,
      reason: 'Invoice cancelled',
      performed_by: req.user.id,
    });
  }

  await supabaseAdmin.from('invoices').update({ status: 'cancelled' }).eq('id', invoice.id);

  await logAudit({ req, action: 'cancel_invoice', entityType: 'invoice', entityId: invoice.id, invoiceNumber: invoice.invoice_number });
  await notify({ shopId: req.user.shop_id, type: 'return', title: 'Invoice cancelled', message: invoice.invoice_number });
  return ok(res, { message: 'Invoice cancelled and stock restored' });
});
