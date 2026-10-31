const fs = require('fs');
const path = require('path');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveCanonicalPath(candidate) {
  let current = path.resolve(candidate);
  const suffix = [];

  while (current !== path.dirname(current)) {
    try {
      fs.lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
      continue;
    }

    const canonicalPath = fs.realpathSync.native(current);
    if (suffix.length && !fs.statSync(canonicalPath).isDirectory()) {
      throw new Error(`[qa-config] Path parent is not a directory: ${current}.`);
    }
    return path.resolve(canonicalPath, ...suffix);
  }

  return path.resolve(fs.realpathSync.native(current), ...suffix);
}

const EXTERNAL_SERVICE_VARIABLES = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_APP_ID',
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ENDPOINT',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_WEBHOOK_SECRET',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'RESEND_API_KEY',
  'BREVO_API_KEY',
  'SENDGRID_API_KEY',
  'MAILGUN_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
];

function assertIsolatedQaConfiguration(env = process.env, backendRoot = path.resolve(__dirname, '..')) {
  if (String(env.GLOBY_QA_MODE || '').trim().toLowerCase() !== 'true') return;

  if (env.NODE_ENV === 'production' || String(env.RENDER_SERVICE_ID || '').trim()) {
    throw new Error('[qa-config] Isolated QA mode is disabled in production.');
  }
  if (String(env.DATA_STORE_MODE || '').trim().toLowerCase() !== 'json') {
    throw new Error('[qa-config] Isolated QA mode requires DATA_STORE_MODE=json.');
  }
  if (String(env.DATABASE_URL || '').trim() || String(env.USE_REAL_DATABASE || '').trim().toLowerCase() === 'true') {
    throw new Error('[qa-config] Isolated QA mode cannot use a database connection.');
  }
  const configuredExternalServices = EXTERNAL_SERVICE_VARIABLES.filter((variable) => String(env[variable] || '').trim());
  if (configuredExternalServices.length) {
    throw new Error(`[qa-config] Isolated QA mode cannot use external services: ${configuredExternalServices.join(', ')}.`);
  }

  const repositoryRoot = resolveCanonicalPath(path.resolve(backendRoot, '..'));
  const qaHome = String(env.GLOBY_QA_HOME || '').trim();
  if (!qaHome) throw new Error('[qa-config] GLOBY_QA_HOME is required in isolated QA mode.');
  const resolvedQaHome = resolveCanonicalPath(qaHome);
  if (isWithin(repositoryRoot, resolvedQaHome)) {
    throw new Error('[qa-config] Isolated QA data must be outside the repository.');
  }

  const configuredFiles = [
    ['GLOBY_SCHOOLS_FILE', 'schools.json'],
    ['GLOBY_AUDIT_FILE', 'audit-logs.json'],
    ['GLOBY_PASSWORD_RESET_TOKENS_FILE', 'password-reset-tokens.json'],
  ];
  for (const [variable, defaultName] of configuredFiles) {
    const configuredPath = String(env[variable] || '').trim();
    if (!configuredPath) throw new Error(`[qa-config] ${variable} is required in isolated QA mode.`);
    const resolvedPath = resolveCanonicalPath(configuredPath);
    if (!isWithin(resolvedQaHome, resolvedPath) || resolvedPath === resolvedQaHome) {
      throw new Error(`[qa-config] ${variable} must be inside GLOBY_QA_HOME.`);
    }

    const protectedPath = resolveCanonicalPath(path.resolve(backendRoot, 'data', defaultName));
    if (resolvedPath.toLowerCase() === protectedPath.toLowerCase()) {
      throw new Error(`[qa-config] ${variable} cannot target the repository data store.`);
    }
  }
}

module.exports = { assertIsolatedQaConfiguration };
