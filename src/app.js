import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { requestContext } from './middleware/requestContext.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import routes from './routes/index.js';

const app = express();

app.set('trust proxy', 1);

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS — allow configured CLIENT_URL(s), any *.vercel.app deployment, and localhost.
// This is robust to preview deployments and trailing-slash mismatches.
const allowedOrigins = (env.clientUrl || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Non-browser requests (curl, server-to-server) have no origin.
      if (!origin) return cb(null, true);
      const clean = origin.replace(/\/+$/, '');
      let host = '';
      try { host = new URL(origin).hostname; } catch { host = ''; }

      const allowed =
        env.clientUrl === '*' ||
        allowedOrigins.includes(clean) ||
        /\.vercel\.app$/i.test(host) ||
        /^localhost$/i.test(host) ||
        host === '127.0.0.1';

      return cb(null, allowed);
    },
    credentials: true,
  }),
);

// Body parsing + compression
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

if (env.nodeEnv !== 'test') app.use(morgan('dev'));

// Global rate limiter
app.use(
  rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please slow down.' },
  }),
);

// Stricter limiter for auth
app.use(
  '/api/auth/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, error: 'Too many login attempts' } }),
);

// Attach device/network context for audit logging
app.use(requestContext);

// API routes
app.use('/api', routes);

app.get('/', (_req, res) => res.json({ name: 'RK Garments API', version: '1.0.0', docs: '/api/health' }));

// 404 + error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
