jest.mock('firebase-admin/app', () => {
  const mockInitializeApp = jest.fn();
  const mockApplicationDefault = jest.fn(() => ({ type: 'application-default' }));
  const mockCert = jest.fn((value) => ({ type: 'service-account', value }));

  return {
    getApps: jest.fn(() => []),
    initializeApp: mockInitializeApp,
    applicationDefault: mockApplicationDefault,
    cert: mockCert,
    __mockInitializeApp: mockInitializeApp,
    __mockApplicationDefault: mockApplicationDefault,
    __mockCert: mockCert,
  };
});
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn(() => ({})) }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn(() => ({})) }));
jest.mock('firebase-admin/storage', () => ({ getStorage: jest.fn(() => ({})) }));

describe('firebase admin ADC configuration', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.RENDER_SERVICE_ID;
    delete process.env.DATA_STORE_MODE;
    delete process.env.GLOBY_QA_MODE;
    process.env.FIREBASE_PROJECT_ID = 'demo-project';
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.DATA_STORE_MODE;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.RENDER_SERVICE_ID;
    delete process.env.GLOBY_QA_MODE;
    jest.clearAllMocks();
  });

  test('disables Firebase Admin configuration and token verification in isolated QA mode', async () => {
    process.env.GLOBY_QA_MODE = 'true';
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');

    expect(firebaseAdmin.isFirebaseConfigured()).toBe(false);
    await expect(firebaseAdmin.verifyIdToken('qa-token')).rejects.toThrow(/disabled in isolated QA mode/);
    expect(adminLib.__mockInitializeApp).not.toHaveBeenCalled();
  });

  test('uses Application Default Credentials when service account env vars are absent', () => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');

    const app = firebaseAdmin.getFirebaseAdmin();

    expect(app).toBeTruthy();
    expect(adminLib.__mockApplicationDefault).toHaveBeenCalledTimes(1);
    expect(adminLib.__mockInitializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'demo-project',
        credential: { type: 'application-default' },
      })
    );
  });

  test('uses the configured service-account credential when its fields are present', () => {
    process.env.FIREBASE_CLIENT_EMAIL = 'service@example.test';
    process.env.FIREBASE_PRIVATE_KEY = 'private-key';
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');

    firebaseAdmin.getFirebaseAdmin();

    expect(adminLib.__mockCert).toHaveBeenCalledWith({
      projectId: 'demo-project',
      clientEmail: 'service@example.test',
      privateKey: 'private-key',
    });
    expect(adminLib.__mockApplicationDefault).not.toHaveBeenCalled();
  });

  test('requires explicit Firebase project and credentials in production Firebase mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATA_STORE_MODE = 'firebase';
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const firebaseAdmin = require('../firebase.admin');

    expect(() => firebaseAdmin.assertFirebaseConfiguration()).toThrow(/FIREBASE_PROJECT_ID is required/);
  });

  test('requires Firebase datastore mode in production even when Admin credentials exist', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATA_STORE_MODE = 'json';
    process.env.FIREBASE_PROJECT_ID = 'demo-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'service@example.test';
    process.env.FIREBASE_PRIVATE_KEY = 'private-key';
    const firebaseAdmin = require('../firebase.admin');

    expect(() => firebaseAdmin.assertFirebaseConfiguration()).toThrow(/Production requires DATA_STORE_MODE=firebase/);
  });

  test('fails closed on Render when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development';
    process.env.RENDER_SERVICE_ID = 'render-service';
    process.env.DATA_STORE_MODE = 'firebase';
    const firebaseAdmin = require('../firebase.admin');

    expect(() => firebaseAdmin.assertFirebaseConfiguration()).toThrow(/Render production requires NODE_ENV=production/);
  });

  test('rejects incomplete service-account environment in production without exposing values', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATA_STORE_MODE = 'firebase';
    process.env.FIREBASE_CLIENT_EMAIL = 'service@example.test';
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    const firebaseAdmin = require('../firebase.admin');

    expect(() => firebaseAdmin.assertFirebaseConfiguration()).toThrow(/configure both Firebase Admin service-account fields/);
  });
});
