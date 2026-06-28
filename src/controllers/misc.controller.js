import XLSX from 'xlsx';
import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { ok, parseListQuery, buildMeta } from '../utils/response.js';
import { uploadImage } from '../services/storage.service.js';
import { logAudit } from '../services/audit.service.js';

// ---- Audit logs (admin/manager) -------------------------------------------
export const listAudit = asyncHandler(async (req, res) => {
  const q = parseListQuery(req.query);
  let query = supabaseAdmin
    .from('audit_logs').select('*', { count: 'exact' }).eq('shop_id', req.user.shop_id);
  if (req.query.action) query = query.eq('action', req.query.action);
  if (req.query.user_id) query = query.eq('user_id', req.query.user_id);
  if (q.search) query = query.or(`action.ilike.%${q.search}%,invoice_number.ilike.%${q.search}%,user_name.ilike.%${q.search}%`);
  query = query.order('created_at', { ascending: false }).range(q.from, q.to);
  const { data, error, count } = await query;
  if (error) throw error;
  return ok(res, data, buildMeta({ page: q.page, limit: q.limit, count }));
});

// ---- Notifications ---------------------------------------------------------
export const listNotifications = asyncHandler(async (req, res) => {
  const q = parseListQuery(req.query);
  let query = supabaseAdmin
    .from('notifications').select('*', { count: 'exact' }).eq('shop_id', req.user.shop_id);
  if (req.query.unread === 'true') query = query.eq('is_read', false);
  query = query.order('created_at', { ascending: false }).range(q.from, q.to);
  const { data, error, count } = await query;
  if (error) throw error;
  return ok(res, data, buildMeta({ page: q.page, limit: q.limit, count }));
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('notifications').update({ is_read: true })
    .eq('id', req.params.id).eq('shop_id', req.user.shop_id);
  if (error) throw error;
  return ok(res, { id: req.params.id, is_read: true });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await supabaseAdmin.from('notifications').update({ is_read: true })
    .eq('shop_id', req.user.shop_id).eq('is_read', false);
  return ok(res, { message: 'All marked read' });
});

// ---- Settings --------------------------------------------------------------
export const getSettings = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('settings').select('key, value').eq('shop_id', req.user.shop_id);
  if (error) throw error;
  const map = (data || []).reduce((a, s) => ({ ...a, [s.key]: s.value }), {});
  const { data: shop } = await supabaseAdmin.from('shops').select('*').eq('id', req.user.shop_id).single();
  return ok(res, { shop, settings: map });
});

export const updateSetting = asyncHandler(async (req, res) => {
  const { key, value } = req.body;
  if (!key) throw badRequest('key is required');
  const { data, error } = await supabaseAdmin
    .from('settings')
    .upsert({ shop_id: req.user.shop_id, key, value, updated_at: new Date().toISOString() }, { onConflict: 'shop_id,key' })
    .select().single();
  if (error) throw error;
  await logAudit({ req, action: 'update_setting', metadata: { key } });
  return ok(res, data);
});

export const updateShop = asyncHandler(async (req, res) => {
  const body = { ...req.body }; delete body.id;
  const { data, error } = await supabaseAdmin
    .from('shops').update(body).eq('id', req.user.shop_id).select().single();
  if (error) throw error;
  await logAudit({ req, action: 'update_shop' });
  return ok(res, data);
});

// ---- Categories & Brands ---------------------------------------------------
export const listCategories = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories').select('*').eq('shop_id', req.user.shop_id).eq('is_active', true).order('name');
  if (error) throw error;
  return ok(res, data);
});

export const createCategory = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories').insert({ shop_id: req.user.shop_id, name: req.body.name, description: req.body.description }).select().single();
  if (error) throw error;
  return ok(res, data, undefined, 201);
});

export const listBrands = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('brands').select('*').eq('shop_id', req.user.shop_id).eq('is_active', true).order('name');
  if (error) throw error;
  return ok(res, data);
});

export const createBrand = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('brands').insert({ shop_id: req.user.shop_id, name: req.body.name, description: req.body.description }).select().single();
  if (error) throw error;
  return ok(res, data, undefined, 201);
});

// ---- Users -----------------------------------------------------------------
export const listUsers = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles').select('id, full_name, email, role, phone, is_active, last_login_at, created_at')
    .eq('shop_id', req.user.shop_id).order('created_at', { ascending: false });
  if (error) throw error;
  return ok(res, data);
});

export const setUserActive = asyncHandler(async (req, res) => {
  const { is_active } = req.body;
  const { data, error } = await supabaseAdmin
    .from('profiles').update({ is_active }).eq('id', req.params.id).eq('shop_id', req.user.shop_id).select().single();
  if (error || !data) throw notFound('User not found');
  await logAudit({ req, action: 'set_user_active', entityType: 'profile', entityId: data.id, metadata: { is_active } });
  return ok(res, data);
});

// ---- Image upload ----------------------------------------------------------
export const uploadProductImages = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw badRequest('No images uploaded');
  const results = [];
  for (const f of files) {
    const r = await uploadImage(f.buffer, { folder: req.user.shop_id });
    results.push({ ...r, is_primary: results.length === 0 });
  }
  await logAudit({ req, action: 'upload_images', metadata: { count: results.length } });
  return ok(res, results, undefined, 201);
});

// ---- File parse (CSV/Excel) -> rows for bulk import ------------------------
export const parseImportFile = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return ok(res, { rows, count: rows.length });
});
