jest.mock('firebase-admin/app', () => {
  const mockApps = [];
  const mockInitializeApp = jest.fn((options) => {
    const app = { options };
    mockApps.push(app);
    return app;
  });
  const mockApplicationDefault = jest.fn(() => ({ type: 'application-default' }));
  const mockCert = jest.fn((value) => ({ type: 'service-account', value }));

  return {
    getApps: jest.fn(() => mockApps),
    initializeApp: mockInitializeApp,
    applicationDefault: mockApplicationDefault,
    cert: mockCert,
    __setApps: (apps) => mockApps.splice(0, mockApps.length, ...apps),
    __mockInitializeApp: mockInitializeApp,
    __mockApplicationDefault: mockApplicationDefault,
    __mockCert: mockCert,
  };
});
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn(() => ({})) }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn(() => ({})) }));
jest.mock('firebase-admin/storage', () => ({ getStorage: jest.fn(() => ({})) }));

const projectIdEnvironmentKeys = ['FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'];
let originalProjectIdEnvironment = {};

describe('firebase admin ADC configuration', () => {
  beforeEach(() => {
    originalProjectIdEnvironment = Object.fromEntries(
      projectIdEnvironmentKeys.map((key) => [key, process.env[key]]),
    );
    process.env.NODE_ENV = 'test';
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.RENDER_SERVICE_ID;
    delete process.env.DATA_STORE_MODE;
    delete process.env.GLOBY_QA_MODE;
    process.env.FIREBASE_PROJECT_ID = 'demo-project';
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    require('firebase-admin/app').__setApps([]);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    for (const key of projectIdEnvironmentKeys) {
      if (originalProjectIdEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalProjectIdEnvironment[key];
      }
    }
    delete process.env.DATA_STORE_MODE;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.RENDER_SERVICE_ID;
    delete process.env.GLOBY_QA_MODE;
    require('firebase-admin/app').__setApps([]);
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

  test('reports only whether the active Firebase project matches its configured project', () => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');

    adminLib.__setApps([{ options: { projectId: 'demo-project' } }]);
    expect(firebaseAdmin.isActiveFirebaseProjectConfigured()).toBe(true);

    adminLib.__setApps([{ options: { projectId: 'other-project' } }]);
    expect(firebaseAdmin.isActiveFirebaseProjectConfigured()).toBe(false);
  });

  test('preserves the startup diagnostic before lazy Firebase Admin initialization', () => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');

    expect(adminLib.getApps()).toHaveLength(0);
    expect(firebaseAdmin.isActiveFirebaseProjectConfigured()).toBe(true);
    expect(adminLib.__mockInitializeApp).not.toHaveBeenCalled();
  });

  test('reuses a matching existing Admin app for Auth, Firestore, and Storage', () => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');
    const existingApp = { options: { projectId: 'demo-project' } };
    adminLib.__setApps([existingApp]);

    const admin = firebaseAdmin.getFirebaseAdmin();
    expect(admin.app).toBe(existingApp);

    admin.auth();
    admin.firestore();
    admin.storage();

    expect(require('firebase-admin/auth').getAuth).toHaveBeenCalledWith(existingApp);
    expect(require('firebase-admin/firestore').getFirestore).toHaveBeenCalledWith(existingApp);
    expect(require('firebase-admin/storage').getStorage).toHaveBeenCalledWith(existingApp);
    expect(adminLib.__mockInitializeApp).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', {}],
    ['mismatched', { projectId: 'other-project' }],
  ])('rejects an existing Admin app with a %s project ID', (_description, options) => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');
    adminLib.__setApps([{ options }]);

    expect(() => firebaseAdmin.getFirebaseAdmin()).toThrow(/Firebase Admin app project/);
    expect(adminLib.__mockInitializeApp).not.toHaveBeenCalled();
  });

  test('does not skip a mismatched first app to use a later matching app', () => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');
    adminLib.__setApps([
      { options: { projectId: 'other-project' } },
      { options: { projectId: 'demo-project' } },
    ]);

    expect(() => firebaseAdmin.getFirebaseAdmin()).toThrow(/Firebase Admin app project/);
    expect(adminLib.__mockInitializeApp).not.toHaveBeenCalled();
  });

  test('successfully initializes and registers a new Admin app with the configured project', () => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');

    const admin = firebaseAdmin.getFirebaseAdmin();

    expect(admin.app.options.projectId).toBe('demo-project');
    expect(adminLib.getApps()).toEqual([admin.app]);
    expect(adminLib.__mockInitializeApp).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing', {}],
    ['mismatched', { projectId: 'other-project' }],
  ])('rejects a newly initialized app with a %s project ID', (_description, options) => {
    const firebaseAdmin = require('../firebase.admin');
    const adminLib = require('firebase-admin/app');
    const app = { options };
    adminLib.__mockInitializeApp.mockImplementationOnce(() => {
      adminLib.__setApps([app]);
      return app;
    });

    expect(() => firebaseAdmin.getFirebaseAdmin()).toThrow(/Firebase Admin app project/);
    expect(adminLib.__mockInitializeApp).toHaveBeenCalledTimes(1);
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
