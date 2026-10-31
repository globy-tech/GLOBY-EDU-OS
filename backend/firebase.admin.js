const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const DEFAULT_PROJECT_ID = 'globyedu-os';

function getProjectId() {
  return String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
}

function getFirebaseConfigurationStatus() {
  const projectId = getProjectId();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const hasServiceAccount = Boolean(clientEmail && privateKey);
  const partialServiceAccount = Boolean(clientEmail) !== Boolean(privateKey);
  const validServiceAccount = hasServiceAccount && /-----BEGIN PRIVATE KEY-----/.test(privateKey) && /-----END PRIVATE KEY-----/.test(privateKey);
  const applicationDefaultAvailable = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE || process.env.GAE_ENV ||
    process.env.GCE_METADATA_HOST || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  );

  return {
    projectIdConfigured: Boolean(projectId || (process.env.NODE_ENV !== 'production' && DEFAULT_PROJECT_ID)),
    serviceAccountConfigured: validServiceAccount,
    serviceAccountIncomplete: partialServiceAccount,
    applicationDefaultAvailable,
    publicClientConfigured: Boolean(
      process.env.FIREBASE_API_KEY && process.env.FIREBASE_AUTH_DOMAIN &&
      process.env.FIREBASE_APP_ID && process.env.FIREBASE_PROJECT_ID
    ),
  };
}

function assertFirebaseConfiguration() {
  const isProduction = process.env.NODE_ENV === 'production';
  const isRenderService = Boolean(String(process.env.RENDER_SERVICE_ID || '').trim());
  if (isRenderService && !isProduction) {
    throw new Error('Render production requires NODE_ENV=production.');
  }
  if (!isProduction && !isRenderService) return;
  if (String(process.env.DATA_STORE_MODE || '').trim().toLowerCase() !== 'firebase') {
    throw new Error('Production requires DATA_STORE_MODE=firebase.');
  }
  const status = getFirebaseConfigurationStatus();
  if (!status.projectIdConfigured) throw new Error('Firebase configuration is incomplete: FIREBASE_PROJECT_ID is required in production.');
  if (status.serviceAccountIncomplete) throw new Error('Firebase configuration is incomplete: configure both Firebase Admin service-account fields or use Application Default Credentials.');
  if (!status.serviceAccountConfigured && !status.applicationDefaultAvailable) {
    throw new Error('Firebase configuration is incomplete: Firebase Admin credentials or Application Default Credentials are required in production.');
  }
  if (status.serviceAccountConfigured && !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(String(process.env.FIREBASE_CLIENT_EMAIL || '').trim())) {
    throw new Error('Firebase configuration is invalid: FIREBASE_CLIENT_EMAIL is not a service-account email.');
  }
}

function isIsolatedQaMode() {
  return String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true';
}

function assertFirebaseAdminEnabled() {
  if (isIsolatedQaMode()) {
    throw new Error('Firebase Admin is disabled in isolated QA mode.');
  }
}

function isFirebaseConfigured() {
  if (isIsolatedQaMode()) return false;
  const status = getFirebaseConfigurationStatus();
  return status.projectIdConfigured;
}

function getFirebaseCredential() {
  assertFirebaseConfiguration();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (clientEmail && privateKey) {
    return cert({
      projectId: getProjectId() || DEFAULT_PROJECT_ID,
      clientEmail,
      privateKey,
    });
  }
  return applicationDefault();
}

function initializeFirebaseAdmin() {
  assertFirebaseAdminEnabled();
  const apps = getApps();
  if (apps.length > 0) return apps[0];

  const credential = getFirebaseCredential();
  const projectId = getProjectId() || (process.env.NODE_ENV !== 'production' ? DEFAULT_PROJECT_ID : '');
  return initializeApp({
    ...(projectId ? { projectId } : {}),
    ...(credential ? { credential } : {}),
  });
}

function getFirebaseAdmin() {
  const app = initializeFirebaseAdmin();
  return {
    app,
    auth: () => getAuth(app),
    firestore: () => getFirestore(app),
    storage: () => getStorage(app),
  };
}

async function verifyIdToken(idToken, checkRevoked = false) {
  const app = getFirebaseAdmin();
  return app.auth().verifyIdToken(idToken, checkRevoked);
}

async function getUser(uid) {
  const app = getFirebaseAdmin();
  return app.auth().getUser(uid);
}

async function getUserByEmail(email) {
  const app = getFirebaseAdmin();
  return app.auth().getUserByEmail(email);
}

async function updateUser(uid, updates) {
  const app = getFirebaseAdmin();
  return app.auth().updateUser(uid, updates);
}

async function revokeRefreshTokens(uid) {
  const app = getFirebaseAdmin();
  return app.auth().revokeRefreshTokens(uid);
}

async function setCustomUserClaims(uid, claims) {
  const app = getFirebaseAdmin();
  return app.auth().setCustomUserClaims(uid, claims);
}

async function createUser({ email, password, displayName }) {
  const app = getFirebaseAdmin();
  return app.auth().createUser({ email, password, displayName, emailVerified: false });
}

async function deleteUser(uid) {
  const app = getFirebaseAdmin();
  return app.auth().deleteUser(uid);
}

async function generateEmailVerificationLink(email, actionCodeSettings) {
  const app = getFirebaseAdmin();
  return app.auth().generateEmailVerificationLink(email, actionCodeSettings);
}

async function generatePasswordResetLink(email, actionCodeSettings) {
  const app = getFirebaseAdmin();
  return app.auth().generatePasswordResetLink(email, actionCodeSettings);
}

module.exports = {
  isFirebaseConfigured,
  getFirebaseConfigurationStatus,
  assertFirebaseConfiguration,
  initializeFirebaseAdmin,
  getFirebaseCredential,
  getFirebaseAdmin,
  verifyIdToken,
  getUser,
  getUserByEmail,
  updateUser,
  revokeRefreshTokens,
  setCustomUserClaims,
  createUser,
  deleteUser,
  generateEmailVerificationLink,
  generatePasswordResetLink,
};
