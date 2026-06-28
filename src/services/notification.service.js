import { supabaseAdmin } from '../config/supabase.js';

/**
 * Insert a notification row. Supabase Realtime broadcasts the INSERT to all
 * subscribed clients (owner panel / dashboards) without polling.
 */
export async function notify({ shopId, type, title, message = null, data = {} }) {
  try {
    const { data: row, error } = await supabaseAdmin
      .from('notifications')
      .insert({ shop_id: shopId, type, title, message, data })
      .select()
      .single();
    if (error) throw error;
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notify] failed:', e.message);
    return null;
  }
}
