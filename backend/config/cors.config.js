const DEVELOPMENT_ORIGINS = [
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:4001',
  'http://127.0.0.1:4001',
  'http://localhost:4002',
  'http://127.0.0.1:4002',
  'http://localhost:4003',
  'http://127.0.0.1:4003',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const PRODUCTION_ORIGINS = [
  'https://globyedu.com',
  'https://www.globyedu.com',
  'https://globy-edu-os.onrender.com',
];

function createCorsOriginValidator({ nodeEnv = process.env.NODE_ENV, configuredOrigins = process.env.CORS_ORIGINS } = {}) {
  const production = nodeEnv === 'production';
  const configured = String(configuredOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    ...PRODUCTION_ORIGINS,
    ...configured,
    ...(!production ? DEVELOPMENT_ORIGINS : []),
  ]);

  return function isAllowedOrigin(origin) {
    if (!origin) return true;

    let parsed;
    try {
      parsed = new URL(origin);
    } catch (error) {
      return false;
    }

    if (production && parsed.protocol !== 'https:') return false;
    if (allowedOrigins.has(origin)) return true;
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'globyedu.com' || parsed.hostname.endsWith('.globyedu.com'));
  };
}

module.exports = { createCorsOriginValidator };
