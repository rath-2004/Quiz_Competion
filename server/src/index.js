import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { autoSubmitExpired } from './services/quiz.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Quiz server listening on http://localhost:${config.port}`);
});
server.keepAliveTimeout = 65_000;

// Finalizes attempts whose time ran out while the student was offline (closed tab, lost network...).
const sweeper = setInterval(async () => {
  try {
    const n = await autoSubmitExpired();
    if (n > 0) console.log(`Auto-submitted ${n} expired attempt(s)`);
  } catch (err) {
    console.error('Auto-submit sweep failed', err);
  }
}, config.autoSubmitIntervalMs);

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  clearInterval(sweeper);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
