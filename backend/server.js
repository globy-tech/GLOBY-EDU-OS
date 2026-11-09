// server.js
// Simple Express server that serves static frontend assets and backend API routes.

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { createCorsOriginValidator } = require('./config/cors.config');

// Load backend configuration consistently for both workspace-root and backend launches.
const isolatedQaMode = String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true';
if (!isolatedQaMode) dotenv.config({ path: path.join(__dirname, '.env') });

require('./config/qa-config').assertIsolatedQaConfiguration(process.env, __dirname);
require('./firebase.admin').assertFirebaseConfiguration();

const apiRoutes = require('./routes/api');

const app = express();

if (process.env.RENDER_SERVICE_ID) app.set('trust proxy', 1);

const isAllowedOrigin = createCorsOriginValidator();

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));

// Allow the existing image data-url workflow to persist valid 2 MB images.
app.use(express.json({
  limit: '12mb',
  verify(req, res, buffer) {
    if (req.originalUrl === '/api/v1/pricing/webhook') req.rawBody = buffer.toString('utf8');
  },
}));

// Log safe request metadata only; never record query strings or request credentials.
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const pathname = req.path;
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
  });
  next();
});

// Mount the API router under a versioned path.
app.use('/api/v1', apiRoutes);

// Expose only Firebase's public web configuration to the browser.
app.get('/config/firebase.js', (req, res) => {
  const publicConfig = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  };

  res.type('application/javascript').set('Cache-Control', 'no-store').send(
    `globalThis.__GLOBYEDU_FIREBASE_CONFIG__ = ${JSON.stringify(publicConfig)};`
  );
});

// Return a no-content response for favicon requests when no favicon asset is present.
app.get('/favicon.ico', (req, res) => res.sendStatus(204));

// Serve frontend static files from the built output when available, otherwise from the source frontend folder.
// In production, the app must not cache HTML/JS/CSS between Render deploys or stale bundles will remain in the browser.
const appRoot = path.join(__dirname, '..');
const distFrontendPath = path.join(appRoot, 'dist', 'frontend');
const sourceFrontendPath = path.join(appRoot, 'frontend');
const sourceMarketingPath = path.join(sourceFrontendPath, 'marketing');
const distMarketingPath = path.join(distFrontendPath, 'marketing');
const frontendPath = fs.existsSync(distFrontendPath) ? distFrontendPath : sourceFrontendPath;
const marketingPath = fs.existsSync(distMarketingPath) ? distMarketingPath : sourceMarketingPath;
const publicPath = path.join(appRoot, 'public');
const rootAssetsPath = path.join(appRoot, 'src', 'assets', 'images');
const marketingAssetsPath = path.join(sourceMarketingPath, 'assets', 'images');
const staticOptions = {
  setHeaders(res, filePath) {
    const fileExtension = path.extname(filePath).toLowerCase();
    if (['.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2'].includes(fileExtension)) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  },
};
app.use('/marketing', express.static(marketingPath, staticOptions));
app.use(express.static(frontendPath, staticOptions));
app.use('/src/assets/images', express.static(marketingAssetsPath));
app.use('/src/assets/images', express.static(rootAssetsPath));
app.use('/root-assets/images', express.static(rootAssetsPath));
app.use('/images', express.static(path.join(publicPath, 'images')));

app.get(/^\/admin(?:\/(.*))?\/?$/, (req, res) => {
  const route = String(req.params[0] || '').trim();
  const target = route === 'login' ? '/#/platform-admin' : `/#/admin${route ? `/${route}` : ''}`;
  return res.redirect(302, target);
});

// Fallback route for client-side routing to load index.html.
// When a URL does not match any API or static file, the client-side router in app.js
// can take over and render the correct frontend view.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ status: 'error', message: 'API route not found.' });
  }

  const hasAssetExtension = /\.[a-z0-9]+$/i.test(req.path);
  if (hasAssetExtension) {
    return res.status(404).type('text/plain').send('Asset not found');
  }

  res.sendFile(path.join(frontendPath, 'index.html'));
});

const DEFAULT_PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

function startServer() {
  const server = app.listen(DEFAULT_PORT, HOST, () => {
    console.log(`GlobyEdu OS backend is running on http://${HOST}:${DEFAULT_PORT}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${DEFAULT_PORT} is already in use. Please stop the running process or set PORT to an unused value before starting the backend.`);
      process.exit(1);
    }

    console.error('Server error:', error);
    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
