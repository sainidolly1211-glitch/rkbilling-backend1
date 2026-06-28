import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { unauthorized, forbidden, asyncHandler } from '../utils/errors.js';

/**
 * Authenticates the request using a Supabase access token (preferred) or our
 * own signed JWT. Loads the user's profile (shop_id + role) onto req.user.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Missing access token');

  let authUser = null;

  // 1) Try Supabase token validation
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (!error && data?.user) {
    authUser = data.user;
  } else if (env.supabaseJwtSecret) {
    // 2) Fallback: verify Supabase JWT secret locally
    try {
      const decoded = jwt.verify(token, env.supabaseJwtSecret);
      authUser = { id: decoded.sub, email: decoded.email };
    } catch {
      authUser = null;
    }
  }

  if (!authUser) throw unauthorized('Invalid or expired token');

  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, shop_id, branch_id, full_name, email, role, is_active')
    .eq('id', authUser.id)
    .single();

  if (pErr || !profile) throw unauthorized('Profile not found');
  if (!profile.is_active) throw forbidden('Account is disabled');

  req.user = profile;
  req.accessToken = token;
  next();
});

/** Restrict a route to specific roles. Usage: requireRole('admin','manager') */
export const requireRole = (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };

/** Only admins may delete anything in this system. */
export const adminOnly = requireRole('admin');
