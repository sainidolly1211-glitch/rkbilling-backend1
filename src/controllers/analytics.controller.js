import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';

const startOf = (period) => {
  const d = new Date();
  switch (period) {
    case 'today': d.setHours(0, 0, 0, 0); break;
    case 'yesterday': d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); break;
    case 'week': d.setDate(d.getDate() - 7); break;
    case 'month': d.setMonth(d.getMonth() - 1); break;
    case 'quarter': d.setMonth(d.getMonth() - 3); break;
    case 'year': d.setFullYear(d.getFullYear() - 1); break;
    default: d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
};

async function sumInvoices(shopId, fromIso, toIso = null) {
  let query = supabaseAdmin
    .from('invoices')
    .select('total, total_profit, payment_mode')
    .eq('shop_id', shopId)
    .eq('is_deleted', false)
    .in('status', ['completed', 'partially_returned'])
    .gte('created_at', fromIso);
  if (toIso) query = query.lt('created_at', toIso);
  const { data } = await query;
  const rows = data || [];
  const acc = { bills: rows.length, revenue: 0, profit: 0, cash: 0, upi: 0, card: 0 };
  for (const r of rows) {
    acc.revenue += Number(r.total);
    acc.profit += Number(r.total_profit);
    if (r.payment_mode === 'cash') acc.cash += Number(r.total);
    else if (r.payment_mode === 'upi') acc.upi += Number(r.total);
    else if (r.payment_mode === 'card') acc.card += Number(r.total);
  }
  acc.avg_bill = acc.bills ? acc.revenue / acc.bills : 0;
  return acc;
}

/** Dashboard KPI bundle. */
export const dashboard = asyncHandler(async (req, res) => {
  const shop = req.user.shop_id;
  const todayStart = startOf('today');
  const yStart = startOf('yesterday');

  const [today, yesterday, week, month, year, inventory] = await Promise.all([
    sumInvoices(shop, todayStart),
    sumInvoices(shop, yStart, todayStart),
    sumInvoices(shop, startOf('week')),
    sumInvoices(shop, startOf('month')),
    sumInvoices(shop, startOf('year')),
    supabaseAdmin.from('v_inventory_value').select('*').eq('shop_id', shop).maybeSingle(),
  ]);

  const { data: topProducts } = await supabaseAdmin
    .from('v_top_products').select('*').eq('shop_id', shop)
    .order('units_sold', { ascending: false }).limit(5);
  const { data: topCategories } = await supabaseAdmin
    .from('v_category_performance').select('*').eq('shop_id', shop)
    .order('revenue', { ascending: false }).limit(5);
  const { data: topBrands } = await supabaseAdmin
    .from('v_brand_performance').select('*').eq('shop_id', shop)
    .order('revenue', { ascending: false }).limit(5);
  const { data: staffPerf } = await supabaseAdmin
    .from('v_staff_performance').select('*').eq('shop_id', shop)
    .order('revenue', { ascending: false }).limit(10);

  return ok(res, {
    today, yesterday, week, month, year,
    inventory: inventory.data || {},
    topProducts: topProducts || [],
    topCategories: topCategories || [],
    topBrands: topBrands || [],
    staffPerformance: staffPerf || [],
  });
});

/** Sales trend grouped by day for charts. */
export const salesTrend = asyncHandler(async (req, res) => {
  const period = req.query.period || 'month';
  const { data, error } = await supabaseAdmin
    .from('v_daily_sales')
    .select('*')
    .eq('shop_id', req.user.shop_id)
    .gte('sale_date', startOf(period).slice(0, 10))
    .order('sale_date', { ascending: true });
  if (error) throw error;
  return ok(res, data);
});

/** Generic breakdown: category|brand|staff. */
export const breakdown = asyncHandler(async (req, res) => {
  const map = {
    category: 'v_category_performance',
    brand: 'v_brand_performance',
    staff: 'v_staff_performance',
    product: 'v_top_products',
  };
  const view = map[req.query.by] || 'v_category_performance';
  const { data, error } = await supabaseAdmin
    .from(view).select('*').eq('shop_id', req.user.shop_id)
    .order('revenue', { ascending: false }).limit(50);
  if (error) throw error;
  return ok(res, data);
});
