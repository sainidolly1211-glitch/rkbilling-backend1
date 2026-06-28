/** Application error with an HTTP status code. */
export class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

export const badRequest = (m, d) => new AppError(m, 400, d);
export const unauthorized = (m = 'Unauthorized') => new AppError(m, 401);
export const forbidden = (m = 'Forbidden') => new AppError(m, 403);
export const notFound = (m = 'Not found') => new AppError(m, 404);
export const conflict = (m = 'Conflict') => new AppError(m, 409);

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
