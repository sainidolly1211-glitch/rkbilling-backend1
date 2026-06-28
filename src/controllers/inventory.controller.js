import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { ok, created, parseListQuery, buildMeta } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { notify } from '../services/notification.service.js';

/** Adjust stock (stock_in, stock_out, adjustment, damage, loss, return, transfer). */
export const adjustStock = asyncHandler(async (req, res) => {
  const { product_id, type, quantity, reason } = req.body;
  if (!product_id || !type) throw badRequest('product_id and type are required');

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty === 0) throw badRequest('quantity must be a non-zero number');

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, name, stock, reorder_level')
    .eq('id', product_id)
    .eq('shop_id', req.user.shop_id)
    .single();
  if (!product) throw notFound('Product not found');

  // outflow types reduce stock
  const outflow = ['stock_out', 'damage', 'loss', 'transfer'].includes(type);
  const delta = outflow ? -Math.abs(qty) : Math.abs(qty);
  const newStock = product.stock + delta;
  if (newStock < 0) throw badRequest('Resulting stock cannot be negative');

  await supabaseAdmin
    .from('products')
    .update({
      stock: newStock,
      status: newStock <= 0 ? 'sold' : 'available',
    })
    .eq('id', product_id);

  await supabaseAdmin.from('stock_movements').insert({
    shop_id: req.user.shop_id,
    product_id,
    type,
    quantity: delta,
    stock_before: product.stock,
    stock_after: newStock,
    reason,
    performed_by: req.user.id,
  });

  await logAudit({ req, action: `stock_${type}`, entityType: 'product', entityId: product_id, metadata: { delta, reason } });
  await notify({ shopId: req.user.shop_id, type: 'manual_adjustment', title: 'Stock adjusted', message: `${product.name}: ${delta > 0 ? '+' : ''}${delta}` });

  if (newStock <= product.reorder_level) {
    await notify({ shopId: req.user.shop_id, type: 'low_stock', title: 'Low stock', message: `${product.name} has ${newStock} left`, data: { product_id } });
  }

  return ok(res, { product_id, stock: newStock });
});

/** Stock movement history with filters. */
export const movements = asyncHandler(async (req, res) => {
  const q = parseListQuery(req.query);
  let query = supabaseAdmin
    .from('stock_movements')
    .select('*, product:products(name, product_code), user:profiles(full_name)', { count: 'exact' })
    .eq('shop_id', req.user.shop_id);
  if (req.query.product_id) query = query.eq('product_id', req.query.product_id);
  if (req.query.type) query = query.eq('type', req.query.type);
  query = query.order('created_at', { ascending: false }).range(q.from, q.to);
  const { data, error, count } = await query;
  if (error) throw error;
  return ok(res, data, buildMeta({ page: q.page, limit: q.limit, count }));
});

/** Inventory overview by status + valuation. */
export const overview = asyncHandler(async (req, res) => {
  const { data: value } = await supabaseAdmin
    .from('v_inventory_value')
    .select('*')
    .eq('shop_id', req.user.shop_id)
    .maybeSingle();

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('status')
    .eq('shop_id', req.user.shop_id)
    .eq('is_deleted', false);

  const byStatus = (products || []).reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  return ok(res, { valuation: value || {}, byStatus });
});

/** Dead stock list (slow movers). */
export const deadStock = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('v_dead_stock')
    .select('*')
    .eq('shop_id', req.user.shop_id)
    .limit(200);
  if (error) throw error;
  return ok(res, data);
});

/** Bulk stock update from import. */
export const bulkAdjust = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw badRequest('No rows');
  let updated = 0;
  for (const r of rows) {
    if (!r.product_code) continue;
    const { data: p } = await supabaseAdmin
      .from('products')
      .select('id, stock')
      .eq('shop_id', req.user.shop_id)
      .eq('product_code', r.product_code)
      .maybeSingle();
    if (!p) continue;
    const newStock = Number(r.stock);
    await supabaseAdmin.from('products').update({ stock: newStock, status: newStock <= 0 ? 'sold' : 'available' }).eq('id', p.id);
    await supabaseAdmin.from('stock_movements').insert({
      shop_id: req.user.shop_id, product_id: p.id, type: 'adjustment',
      quantity: newStock - p.stock, stock_before: p.stock, stock_after: newStock,
      reason: 'Bulk update', performed_by: req.user.id,
    });
    updated += 1;
  }
  await logAudit({ req, action: 'bulk_stock_update', entityType: 'product', metadata: { updated } });
  return created(res, { updated });
});
