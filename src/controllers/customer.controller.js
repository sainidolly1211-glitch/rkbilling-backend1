import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { ok, created, parseListQuery, buildMeta } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';

export const listCustomers = asyncHandler(async (req, res) => {
  const q = parseListQuery(req.query);
  let query = supabaseAdmin
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('shop_id', req.user.shop_id)
    .eq('is_deleted', false);
  if (q.search) query = query.or(`name.ilike.%${q.search}%,phone.ilike.%${q.search}%,email.ilike.%${q.search}%`);
  query = query.order(q.sort, { ascending: q.order === 'asc' }).range(q.from, q.to);
  const { data, error, count } = await query;
  if (error) throw error;
  return ok(res, data, buildMeta({ page: q.page, limit: q.limit, count }));
});

export const getCustomer = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('customers').select('*').eq('id', req.params.id).eq('shop_id', req.user.shop_id).single();
  if (error || !data) throw notFound('Customer not found');

  const { data: history } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, total, created_at, payment_mode, status')
    .eq('customer_id', data.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(50);

  return ok(res, { ...data, purchase_history: history || [] });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  const { data, error } = await supabaseAdmin
    .from('customers')
    .insert({ shop_id: req.user.shop_id, name, phone, email, address })
    .select().single();
  if (error) throw error;
  await logAudit({ req, action: 'create_customer', entityType: 'customer', entityId: data.id });
  return created(res, data);
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  delete body.id; delete body.shop_id; delete body.lifetime_purchase; delete body.reward_points;
  const { data, error } = await supabaseAdmin
    .from('customers').update(body).eq('id', req.params.id).eq('shop_id', req.user.shop_id).select().single();
  if (error || !data) throw notFound('Customer not found');
  await logAudit({ req, action: 'update_customer', entityType: 'customer', entityId: data.id });
  return ok(res, data);
});

export const softDeleteCustomer = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('customers').update({ is_deleted: true }).eq('id', req.params.id).eq('shop_id', req.user.shop_id).select().single();
  if (error || !data) throw notFound('Customer not found');
  await logAudit({ req, action: 'soft_delete_customer', entityType: 'customer', entityId: data.id });
  return ok(res, { message: 'Customer archived', id: data.id });
});
