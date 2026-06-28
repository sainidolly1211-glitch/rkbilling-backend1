import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 RK Garments API running on port ${env.port} [${env.nodeEnv}]`);
});

// Graceful shutdown
const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received. Closing server...`);
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled Rejection:', err);
});
