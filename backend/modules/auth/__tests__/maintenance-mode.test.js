const mockStore = { collections: new Map() };

function collectionRecords(name) {
  if (!mockStore.collections.has(name)) mockStore.collections.set(name, new Map());
  return mockStore.collections.get(name);
}

const mockFirestore = {
  collection(name) {
    return {
      doc(id) {
        const documentId = String(id);
        return {
          get: async () => {
            const value = collectionRecords(name).get(documentId);
            return { exists: value !== undefined, id: documentId, data: () => value };
          },
          set: async (value, options = {}) => {
            const current = collectionRecords(name).get(documentId);
            collectionRecords(name).set(documentId, options.merge === false ? value : { ...(current || {}), ...value });
          },
        };
      },
    };
  },
};

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockFirestore,
}));
jest.mock('../../../config/prisma.client', () => null);
jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  getUser: jest.fn(async () => ({ disabled: false, customClaims: {} })),
  verifyIdToken: jest.fn(),
}));
jest.mock('../utils/token', () => ({
  ...jest.requireActual('../utils/token'),
  verifyAccessToken: jest.fn(),
}));
jest.mock('../../audit/audit.service', () => ({ recordAuditEvent: jest.fn(async () => null) }));

const firebaseCore = require('../../../firebase.core');
const authMiddleware = require('../middleware/auth.middleware');
const { verifyAccessToken } = require('../utils/token');
const express = require('express');
const platformAdminRoutes = require('../../platform-admin/platform-admin.routes');

function requestContext(path = '/api/v1/schools/school-a') {
  return {
    req: { headers: { authorization: 'Bearer app-token' }, baseUrl: path.startsWith('/api/v1/auth/') ? '/api/v1/auth' : '', path: path.startsWith('/api/v1/auth/') ? path.slice('/api/v1/auth'.length) : path },
    res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
    next: jest.fn(),
  };
}

function seedAuthUser({ roles = ['teacher'], platformAdmin = false, tenantId = 'school-a', userId = 'user-1' } = {}) {
  collectionRecords('users').set(userId, {
    status: 'active',
    tenantId,
    schoolId: tenantId,
    roles,
    role: roles[0],
    platformAdmin,
    passwordNeedsReset: false,
  });
  collectionRecords('authSessions').set('session-1', {
    userId,
    expiresAt: Date.now() + 60_000,
    revoked: false,
  });
  verifyAccessToken.mockReturnValue({ userId, tenantId, sessionId: 'session-1', roles });
}

let server;
let platformAdminUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/platform-admins', platformAdminRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  platformAdminUrl = `http://127.0.0.1:${server.address().port}/api/v1/platform-admins/maintenance`;
});

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  mockStore.collections.clear();
  seedAuthUser();
});

describe('server-enforced maintenance mode', () => {
  test('persists enabled and disabled state across independent Firestore reads', async () => {
    await expect(firebaseCore.getMaintenanceMode()).resolves.toBe(false);

    await firebaseCore.setMaintenanceMode(true, 'super-admin-1');
    const independentRead = await firebaseCore.getMaintenanceMode();
    expect(independentRead).toBe(true);

    await firebaseCore.setMaintenanceMode(false, 'super-admin-1');
    expect(await firebaseCore.getMaintenanceMode()).toBe(false);
  });

  test('blocks an authenticated normal user with a clear maintenance response', async () => {
    await firebaseCore.setMaintenanceMode(true, 'super-admin-1');
    const { req, res, next } = requestContext();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      code: 'MAINTENANCE_MODE',
      message: expect.any(String),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('allows a verified tenantless Super Admin to access maintenance controls', async () => {
    await firebaseCore.setMaintenanceMode(true, 'super-admin-1');
    seedAuthUser({ roles: ['super_admin'], platformAdmin: true, tenantId: null, userId: 'super-admin-1' });
    const { req, res, next } = requestContext('/api/v1/platform-admins/maintenance');

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('lets a Super Admin read and disable persisted maintenance through the guarded control routes', async () => {
    await firebaseCore.setMaintenanceMode(true, 'super-admin-1');
    seedAuthUser({ roles: ['super_admin'], platformAdmin: true, tenantId: null, userId: 'super-admin-1' });
    verifyAccessToken.mockReturnValue({ userId: 'super-admin-1', tenantId: null, sessionId: 'session-1', roles: ['super_admin'] });

    const readResponse = await fetch(platformAdminUrl, {
      headers: { Authorization: 'Bearer app-token' },
    });
    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toEqual({ status: 'ok', maintenanceMode: true });

    const writeResponse = await fetch(platformAdminUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer app-token' },
      body: JSON.stringify({ maintenanceMode: false }),
    });
    expect(writeResponse.status).toBe(200);
    expect(await writeResponse.json()).toEqual({ status: 'ok', maintenanceMode: false });
    expect(await firebaseCore.getMaintenanceMode()).toBe(false);
  });

  test('allows normal users through when maintenance is disabled', async () => {
    await firebaseCore.setMaintenanceMode(false, 'super-admin-1');
    const { req, res, next } = requestContext();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each(['/api/v1/auth/logout', '/api/v1/auth/change-password'])('keeps %s available during maintenance', async (path) => {
    await firebaseCore.setMaintenanceMode(true, 'super-admin-1');
    const { req, res, next } = requestContext(path);

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
