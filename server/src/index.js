import cluster from 'node:cluster';
import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { bootstrapAdmin } from './services/admins.js';
import { startSweeper, stopSweeper } from './services/attempts.js';

async function prepareDatabase() {
  await migrate();
  await bootstrapAdmin();
}

function startServer() {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Quiz server (pid ${process.pid}) listening on http://localhost:${config.port}`);
  });
  // Outlive the idle timeouts of browsers and proxies (nginx, load balancers) so a reused
  // keep-alive connection is never closed by us at the moment a request is sent on it.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  // Every worker sweeps; FOR UPDATE SKIP LOCKED keeps them from colliding.
  startSweeper();

  const shutdown = () => {
    stopSweeper();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const workers = Math.max(1, config.webConcurrency);

if (workers > 1 && cluster.isPrimary) {
  await prepareDatabase();
  await pool.end();
  console.log(`Starting ${workers} worker processes`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT' || code === 0) return;
    console.error(`Worker ${worker.process.pid} exited (${signal || code}); starting a replacement`);
    cluster.fork();
  });
} else {
  if (workers === 1) await prepareDatabase();
  startServer();
}
