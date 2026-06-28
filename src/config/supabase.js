import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from './env.js';

// Node < 22 has no native WebSocket; supabase-js realtime needs one.
// The backend doesn't use realtime, but the client constructor still
// initialises it — so we hand it the `ws` implementation to avoid a crash.
const realtime = { transport: WebSocket };

/**
 * Service-role client: bypasses RLS. Used by the trusted backend which performs
 * its own JWT + role-based authorization. NEVER expose this key to the client.
 */
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime,
});

/**
 * Anon client factory scoped to a user's access token (respects RLS).
 * Useful for actions that should be performed strictly as the end user.
 */
export const supabaseAsUser = (accessToken) =>
  createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
    realtime,
  });

/**
 * Fresh anon client used ONLY for auth actions (signInWithPassword / refresh).
 * A new instance per call ensures the in-memory user session never pollutes the
 * shared service-role client (which must stay pure to bypass RLS).
 */
export const newAuthClient = () =>
  createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime,
  });
