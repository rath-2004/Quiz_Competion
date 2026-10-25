import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import adminRoutes from './routes/admin/index.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/student.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Question images may be hosted anywhere.
          'img-src': ["'self'", 'data:', 'https:', 'http:'],
          'upgrade-insecure-requests': config.https ? [] : null,
        },
      },
      strictTransportSecurity: config.https,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  if (config.corsOrigin) {
    app.use('/api', (req, res, next) => {
      const origin = req.get('origin');
      if (origin && config.corsOrigin.split(',').includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Credentials', 'true');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.set('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // CSV imports can be large; everything else stays small.
  app.use('/api/admin', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date() }));
  app.use('/api/auth', authRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the API also serves the built React app.
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
