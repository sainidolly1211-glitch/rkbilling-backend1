import dotenv from 'dotenv';
dotenv.config();

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length && process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-console
  console.warn(`[env] Missing required environment variables: ${missing.join(', ')}`);
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET,

  buckets: {
    products: process.env.SUPABASE_BUCKET_PRODUCTS || 'product-images',
    invoices: process.env.SUPABASE_BUCKET_INVOICES || 'invoices',
    logos: process.env.SUPABASE_BUCKET_LOGOS || 'logos',
    backups: process.env.SUPABASE_BUCKET_BACKUPS || 'backups',
  },

  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),

  highValueThreshold: parseFloat(process.env.HIGH_VALUE_SALE_THRESHOLD || '5000'),
};
