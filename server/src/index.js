import cluster from 'node:cluster';
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { autoSubmitExpired } from './services/quiz.js';

// Finalizes attempts whose time ran out while the student was offline (closed tab, lost network...).
function startSweeper() {
  return setInterval(async () => {
    try {
      const n = await autoSubmitExpired();
      if (n > 0) console.log(`Auto-submitted ${n} expired attempt(s)`);
    } catch (err) {
      console.error('Auto-submit sweep failed', err);
    }
  }, config.autoSubmitIntervalMs);
}

function onSignals(handler) {
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

if (cluster.isPrimary && config.workers > 1) {
  // One worker per CPU core; the primary only supervises workers and runs the sweeper.
  console.log(`Starting ${config.workers} workers`);
  let stopping = false;
  for (let i = 0; i < config.workers; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return;
    console.error(`Worker ${worker.process.pid} exited (${signal || code}); starting a new one`);
    cluster.fork();
  });
  const sweeper = startSweeper();
  onSignals((signal) => {
    console.log(`${signal} received, shutting down`);
    stopping = true;
    clearInterval(sweeper);
    for (const worker of Object.values(cluster.workers)) worker.process.kill('SIGTERM');
    setTimeout(() => pool.end().then(() => process.exit(0)), 1000);
  });
} else {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Quiz server listening on http://localhost:${config.port} (pid ${process.pid})`);
  });
  server.keepAliveTimeout = 65_000;
  const sweeper = cluster.isWorker ? null : startSweeper();
  onSignals((signal) => {
    if (!cluster.isWorker) console.log(`${signal} received, shutting down`);
    clearInterval(sweeper);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
