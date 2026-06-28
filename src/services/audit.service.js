import { supabaseAdmin } from '../config/supabase.js';

/**
 * Write an immutable audit log entry. Fraud-prevention: records user, action,
 * timestamp, IP, browser, OS, device and the related invoice/entity.
 */
export async function logAudit({
  req,
  action,
  entityType = null,
  entityId = null,
  invoiceNumber = null,
  metadata = {},
}) {
  try {
    const user = req.user || {};
    const ctx = req.context || {};
    await supabaseAdmin.from('audit_logs').insert({
      shop_id: user.shop_id || null,
      user_id: user.id || null,
      user_name: user.full_name || null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      invoice_number: invoiceNumber,
      ip_address: ctx.ip || null,
      browser: ctx.browser || null,
      os: ctx.os || null,
      device: ctx.device || null,
      user_agent: ctx.userAgent || null,
      metadata,
    });
  } catch (e) {
    // Never let audit failures break the main flow
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write log:', e.message);
  }
}
