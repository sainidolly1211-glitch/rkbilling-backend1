import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // Postgres / Supabase specific mappings
  if (err.code === '23505') {
    status = 409;
    message = 'A record with these details already exists';
  } else if (err.code === '23503') {
    status = 400;
    message = 'Related record not found (foreign key violation)';
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(err instanceof AppError && err.details ? { details: err.details } : {}),
    ...(env.nodeEnv === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
}
