import XLSX from 'xlsx';
import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';

/** One-click owner report data (JSON). Frontend renders / exports PDF. */
export const ownerReport = asyncHandler(async (req, res) => {
  const shop = req.user.shop_id;
  const from = req.query.from || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString();
  const to = req.query.to || new Date().toISOString();

  const { data: invoices } = await supabaseAdmin
    .from('invoices').select('total, total_profit, payment_mode')
    .eq('shop_id', shop).eq('is_deleted', false).in('status', ['completed', 'partially_returned'])
    .gte('created_at', from).lte('created_at', to);

  const totals = (invoices || []).reduce(
    (a, i) => {
      a.revenue += Number(i.total); a.profit += Number(i.total_profit); a.bills += 1;
      a[i.payment_mode] = (a[i.payment_mode] || 0) + Number(i.total);
      return a;
    },
    { revenue: 0, profit: 0, bills: 0, cash: 0, upi: 0, card: 0, mixed: 0 },
  );

  const [topProducts, worstProducts, categoryPerf, brandPerf, staffPerf, deadStock, inventory] = await Promise.all([
    supabaseAdmin.from('v_top_products').select('*').eq('shop_id', shop).order('revenue', { ascending: false }).limit(10),
    supabaseAdmin.from('v_top_products').select('*').eq('shop_id', shop).order('units_sold', { ascending: true }).limit(10),
    supabaseAdmin.from('v_category_performance').select('*').eq('shop_id', shop).order('revenue', { ascending: false }),
    supabaseAdmin.from('v_brand_performance').select('*').eq('shop_id', shop).order('revenue', { ascending: false }),
    supabaseAdmin.from('v_staff_performance').select('*').eq('shop_id', shop).order('revenue', { ascending: false }),
    supabaseAdmin.from('v_dead_stock').select('id, product_code, name, stock, images, selling_price').eq('shop_id', shop).limit(50),
    supabaseAdmin.from('v_inventory_value').select('*').eq('shop_id', shop).maybeSingle(),
  ]);

  await logAudit({ req, action: 'generate_owner_report', metadata: { from, to } });

  return ok(res, {
    period: { from, to },
    totals,
    topProducts: topProducts.data || [],
    worstProducts: worstProducts.data || [],
    categoryPerformance: categoryPerf.data || [],
    brandPerformance: brandPerf.data || [],
    staffPerformance: staffPerf.data || [],
    deadStock: deadStock.data || [],
    inventory: inventory.data || {},
  });
});

/** Admin: below-cost (loss) sales — item, cost, sold price, loss, who, when. */
export const belowCostSales = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('invoice_items')
    .select('id, product_code, product_name, product_image, purchase_price, selling_price, quantity, line_total, created_at, invoices!inner(invoice_number, shop_id, created_at, staff:profiles(full_name), customer:customers(name, phone))')
    .eq('is_below_cost', true)
    .eq('invoices.shop_id', req.user.shop_id)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = (data || []).map((r) => ({
    id: r.id,
    invoice_number: r.invoices?.invoice_number,
    product_code: r.product_code,
    product_name: r.product_name,
    product_image: r.product_image,
    cost_price: Number(r.purchase_price),
    sold_price: Number(r.selling_price),
    quantity: r.quantity,
    revenue: Number(r.line_total),
    loss: Math.max(0, (Number(r.purchase_price) - Number(r.selling_price)) * r.quantity),
    staff: r.invoices?.staff?.full_name || null,
    customer: r.invoices?.customer?.name || null,
    created_at: r.created_at,
  }));

  const totals = rows.reduce(
    (a, r) => { a.revenue += r.revenue; a.loss += r.loss; a.count += 1; return a; },
    { revenue: 0, loss: 0, count: 0 },
  );

  return ok(res, { rows, totals });
});

/** Export invoices or products as Excel/CSV. ?type=invoices|products&format=xlsx|csv */
export const exportData = asyncHandler(async (req, res) => {
  const type = req.query.type === 'products' ? 'products' : 'invoices';
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';

  let rows = [];
  if (type === 'invoices') {
    const { data } = await supabaseAdmin
      .from('invoices')
      .select('invoice_number, total, total_profit, payment_mode, status, created_at')
      .eq('shop_id', req.user.shop_id).eq('is_deleted', false)
      .order('created_at', { ascending: false }).limit(5000);
    rows = data || [];
  } else {
    const { data } = await supabaseAdmin
      .from('products')
      .select('product_code, name, color, size, purchase_price, selling_price, stock, status')
      .eq('shop_id', req.user.shop_id).eq('is_deleted', false).limit(10000);
    rows = data || [];
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type);

  await logAudit({ req, action: `export_${type}`, metadata: { format, count: rows.length } });

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}.csv`);
    return res.send(csv);
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${type}.xlsx`);
  return res.send(buf);
});
