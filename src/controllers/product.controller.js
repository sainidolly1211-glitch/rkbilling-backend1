import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { ok, created, parseListQuery, buildMeta } from '../utils/response.js';
import { calcHkPurchasePrice } from '../utils/hkTag.js';
import { logAudit } from '../services/audit.service.js';
import { notify } from '../services/notification.service.js';

const TABLE = 'products';

/** Preview the purchase price for a product code (HK tag logic). */
export const previewPrice = asyncHandler(async (req, res) => {
  const code = req.query.code || req.params.code;
  const price = calcHkPurchasePrice(code);
  return ok(res, {
    code,
    isHkTag: price !== null,
    purchasePrice: price,
    priceSource: price !== null ? 'hk_tag' : 'manual',
  });
});

/** List products with pagination, search, filtering and sorting. */
export const listProducts = asyncHandler(async (req, res) => {
  const q = parseListQuery(req.query);
  let query = supabaseAdmin
    .from(TABLE)
    .select('*, category:categories(name), brand:brands(name)', { count: 'exact' })
    .eq('shop_id', req.user.shop_id)
    .eq('is_deleted', false);

  if (q.search) {
    query = query.or(
      `product_code.ilike.%${q.search}%,name.ilike.%${q.search}%,barcode.ilike.%${q.search}%`,
    );
  }
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.category_id) query = query.eq('category_id', req.query.category_id);
  if (req.query.brand_id) query = query.eq('brand_id', req.query.brand_id);
  if (req.query.color) query = query.eq('color', req.query.color);
  if (req.query.size) query = query.eq('size', req.query.size);
  if (req.query.low_stock === 'true') query = query.lte('stock', 5);

  query = query.order(q.sort, { ascending: q.order === 'asc' }).range(q.from, q.to);

  const { data, error, count } = await query;
  if (error) throw error;
  return ok(res, data, buildMeta({ page: q.page, limit: q.limit, count }));
});

/**
 * Lookup a product by code for billing. The same code can repeat in the
 * notebook inventory, so we pick the in-stock row with the most stock first.
 * The `matches` count tells the UI when duplicates exist.
 */
export const findByCode = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*, category:categories(name), brand:brands(name)')
    .eq('shop_id', req.user.shop_id)
    .eq('is_deleted', false)
    .or(`product_code.eq.${code},barcode.eq.${code}`)
    .order('stock', { ascending: false })
    .limit(10);
  if (error) throw error;
  if (!data || data.length === 0) throw notFound('Product not found for this code');
  const chosen = data.find((p) => p.stock > 0) || data[0];
  return ok(res, { ...chosen, matches: data.length });
});

export const getProduct = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*, category:categories(name), brand:brands(name)')
    .eq('id', req.params.id)
    .eq('shop_id', req.user.shop_id)
    .single();
  if (error || !data) throw notFound('Product not found');
  return ok(res, data);
});

/** Create a product. HK tag auto-prices; manual requires purchase_price. */
export const createProduct = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  const hk = calcHkPurchasePrice(body.product_code);

  if (hk !== null) {
    body.price_source = 'hk_tag';
    body.purchase_price = hk;
  } else {
    body.price_source = 'manual';
    if (body.purchase_price === undefined || body.purchase_price === null || body.purchase_price === '') {
      throw badRequest('Manual products require a purchase_price');
    }
  }

  if (Number(body.selling_price) < Number(body.purchase_price)) {
    throw badRequest('Selling price cannot be lower than purchase price');
  }

  const insert = {
    ...body,
    shop_id: req.user.shop_id,
    branch_id: body.branch_id || req.user.branch_id,
    created_by: req.user.id,
  };

  const { data, error } = await supabaseAdmin.from(TABLE).insert(insert).select().single();
  if (error) throw error;

  await logAudit({ req, action: 'create_product', entityType: 'product', entityId: data.id, metadata: { code: data.product_code } });
  return created(res, data);
});

export const updateProduct = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  delete body.id;
  delete body.shop_id;
  delete body.is_deleted;

  if (body.product_code) {
    const hk = calcHkPurchasePrice(body.product_code);
    if (hk !== null) {
      body.price_source = 'hk_tag';
      body.purchase_price = hk;
    }
  }
  if (
    body.selling_price !== undefined &&
    body.purchase_price !== undefined &&
    Number(body.selling_price) < Number(body.purchase_price)
  ) {
    throw badRequest('Selling price cannot be lower than purchase price');
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(body)
    .eq('id', req.params.id)
    .eq('shop_id', req.user.shop_id)
    .select()
    .single();
  if (error || !data) throw notFound('Product not found');

  await logAudit({ req, action: 'update_product', entityType: 'product', entityId: data.id });
  return ok(res, data);
});

/** Soft delete only (admin enforced at route). Never hard-deletes. */
export const softDeleteProduct = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ is_deleted: true })
    .eq('id', req.params.id)
    .eq('shop_id', req.user.shop_id)
    .select()
    .single();
  if (error || !data) throw notFound('Product not found');

  await logAudit({ req, action: 'soft_delete_product', entityType: 'product', entityId: data.id });
  return ok(res, { message: 'Product archived (soft deleted)', id: data.id });
});

/** Bulk import products (parsed rows from CSV/Excel). */
export const bulkImport = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw badRequest('No rows provided');

  const prepared = rows.map((r) => {
    const hk = calcHkPurchasePrice(r.product_code);
    return {
      shop_id: req.user.shop_id,
      branch_id: req.user.branch_id,
      created_by: req.user.id,
      product_code: r.product_code,
      barcode: r.barcode || null,
      name: r.name,
      color: r.color || null,
      size: r.size || null,
      rack_number: r.rack_number || null,
      stock: Number(r.stock || 0),
      selling_price: Number(r.selling_price || 0),
      mrp: r.mrp ? Number(r.mrp) : null,
      price_source: hk !== null ? 'hk_tag' : 'manual',
      purchase_price: hk !== null ? hk : Number(r.purchase_price || 0),
    };
  });

  // Insert rows (duplicate codes are allowed for notebook inventory)
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert(prepared)
    .select('id');
  if (error) throw error;

  await logAudit({ req, action: 'bulk_import_products', entityType: 'product', metadata: { count: data.length } });
  await notify({ shopId: req.user.shop_id, type: 'manual_adjustment', title: 'Bulk import complete', message: `${data.length} products imported/updated` });
  return created(res, { imported: data.length });
});
