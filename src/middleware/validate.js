import { validationResult } from 'express-validator';
import { badRequest } from '../utils/errors.js';

/** Collects express-validator results and throws a 400 with details. */
export function validate(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
  return next(badRequest('Validation failed', details));
}

/** Lightweight XSS sanitizer: strips angle-bracket tags from string inputs. */
export function sanitizeBody(req, _res, next) {
  const clean = (v) =>
    typeof v === 'string' ? v.replace(/<\s*\/?\s*(script|iframe|object|embed)[^>]*>/gi, '') : v;
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') obj[k] = clean(obj[k]);
      else if (typeof obj[k] === 'object') walk(obj[k]);
    }
  };
  walk(req.body);
  next();
}
