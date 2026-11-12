const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { assertIsolatedQaConfiguration } = require('../backend/config/qa-config');

const repositoryRoot = path.resolve(__dirname, '..');
const qaHome = path.resolve(
  process.env.GLOBY_QA_HOME
    || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'GlobyEdu-QA'),
);
const externalServiceVariables = [
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
  'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_APP_ID',
  'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ENDPOINT',
  'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_WEBHOOK_SECRET',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'RESEND_API_KEY', 'BREVO_API_KEY',
  'SENDGRID_API_KEY', 'MAILGUN_API_KEY', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
];

function assertQaFilesExist(env) {
  const requiredFiles = [
    env.GLOBY_SCHOOLS_FILE,
    env.GLOBY_AUDIT_FILE,
    env.GLOBY_PASSWORD_RESET_TOKENS_FILE,
  ];

  for (const file of requiredFiles) {
    let stats;
    try {
      stats = fs.statSync(file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        throw new Error(`Isolated QA data is incomplete under ${qaHome}; required files are missing. Existing files are never overwritten.`);
      }
      throw error;
    }
    if (!stats.isFile()) throw new Error(`Isolated QA data path is not a file: ${file}.`);
  }
}

function assertPortIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Unable to verify whether port ${port} is available.`));
    }, 500);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error(`Port ${port} is already in use. Refusing to start a duplicate QA server.`));
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}

async function startLocalQa() {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    GLOBY_QA_MODE: 'true',
    DATA_STORE_MODE: 'json',
    PORT: '4001',
    GLOBY_QA_HOME: qaHome,
    GLOBY_SCHOOLS_FILE: path.join(qaHome, 'schools.json'),
    GLOBY_AUDIT_FILE: path.join(qaHome, 'audit-logs.json'),
    GLOBY_PASSWORD_RESET_TOKENS_FILE: path.join(qaHome, 'password-reset-tokens.json'),
    DATABASE_URL: '',
    USE_REAL_DATABASE: '',
    APP_URL: 'http://127.0.0.1:4001',
  };
  for (const variable of externalServiceVariables) env[variable] = '';

  assertQaFilesExist(env);
  assertIsolatedQaConfiguration(env, path.join(repositoryRoot, 'backend'));
  await assertPortIsAvailable(4001);

  env.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('base64');
  env.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('base64');

  console.log('Starting isolated local QA server at http://127.0.0.1:4001/');
  console.log(`QA data root: ${qaHome}`);

  const server = spawn(process.execPath, ['backend/server.js'], {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  });
  server.once('error', (error) => {
    console.error(`Unable to start the local QA server: ${error.message}`);
    process.exitCode = 1;
  });
  server.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code || 0;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.kill(signal));
  }
}

startLocalQa().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
