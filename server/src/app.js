import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db/pool.js';
import { errorHandler } from './lib/errors.js';
import { adminRouter } from './routes/admin/index.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { studentRouter } from './routes/student.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // HTTPS-only headers would break a plain-http campus LAN deployment (the browser would
  // rewrite every asset and API request to https), so they follow the COOKIE_SECURE setting.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.cookieSecure ? [] : null } },
      strictTransportSecurity: config.cookieSecure,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (req, res) => {
    await query('SELECT 1');
    res.json({ ok: true, time: new Date() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/student', studentRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', publicRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the API also serves the built React app.
  const dist = config.paths.clientDist;
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
