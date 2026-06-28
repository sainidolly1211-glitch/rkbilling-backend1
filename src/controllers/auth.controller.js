import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, unauthorized, badRequest } from '../utils/errors.js';
import { ok, created } from '../utils/response.js';
import { logAudit } from '../services/audit.service.js';
import { notify } from '../services/notification.service.js';

/**
 * Login via Supabase Auth (email + password). Returns the session + profile.
 * Records login / failed-login audit + notification (fraud monitoring).
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    await logAudit({ req, action: 'failed_login', metadata: { email } });
    throw unauthorized('Invalid email or password');
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (!profile) throw unauthorized('No profile linked to this account');
  if (!profile.is_active) throw unauthorized('Account disabled. Contact admin.');

  await supabaseAdmin
    .from('profiles')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', profile.id);

  // attach for audit context
  req.user = profile;
  await logAudit({ req, action: 'login', entityType: 'auth', entityId: profile.id });
  await notify({
    shopId: profile.shop_id,
    type: 'login',
    title: 'User logged in',
    message: `${profile.full_name} (${profile.role}) signed in`,
    data: { userId: profile.id, ip: req.context?.ip },
  });

  return ok(res, {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: profile,
  });
});

/** Returns the currently authenticated profile. */
export const me = asyncHandler(async (req, res) => ok(res, req.user));

/** Refresh a Supabase session token. */
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw badRequest('refreshToken is required');
  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) throw unauthorized('Could not refresh session');
  return ok(res, {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
});

/**
 * Admin creates a new staff/manager/admin user (Supabase Auth + profile).
 */
export const createUser = asyncHandler(async (req, res) => {
  const { email, password, full_name, role = 'staff', phone, branch_id } = req.body;

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr) throw badRequest(authErr.message);

  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      shop_id: req.user.shop_id,
      branch_id: branch_id || req.user.branch_id,
      full_name,
      email,
      phone,
      role,
    })
    .select()
    .single();

  if (pErr) {
    // rollback auth user if profile creation fails
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw badRequest(pErr.message);
  }

  await logAudit({ req, action: 'create_user', entityType: 'profile', entityId: profile.id, metadata: { role } });
  return created(res, profile);
});

export const logout = asyncHandler(async (req, res) => {
  await logAudit({ req, action: 'logout', entityType: 'auth', entityId: req.user.id });
  return ok(res, { message: 'Logged out' });
});
