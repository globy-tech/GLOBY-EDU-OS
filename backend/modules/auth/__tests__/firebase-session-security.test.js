const mockState = { user: null, session: null, claims: null };

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => ({
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          const value = name === 'users' ? mockState.user : name === 'authSessions' ? mockState.session : null;
          return value ? { exists: true, id, data: () => value } : { exists: false, id, data: () => null };
        },
      }),
    }),
  }),
}));

jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: () => true,
  getUser: jest.fn(async () => ({ disabled: false, customClaims: mockState.claims })),
  verifyIdToken: jest.fn(),
}));

jest.mock('../../../firebase.core', () => ({
  getMaintenanceMode: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../config/prisma.client', () => null);
jest.mock('../utils/token', () => ({
  ...jest.requireActual('../utils/token'),
  verifyAccessToken: jest.fn(),
}));

const authMiddleware = require('../middleware/auth.middleware');
const { verifyAccessToken } = require('../utils/token');

function requestContext() {
  return {
    req: { headers: { authorization: 'Bearer app-token' }, path: '/api/v1/private' },
    res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
    next: jest.fn(),
  };
}

describe('Firebase session authorization', () => {
  beforeEach(() => {
    mockState.user = {
      status: 'active',
      tenantId: 'school-a',
      role: 'teacher',
      roles: ['teacher'],
      firebaseUid: 'firebase-user-1',
      platformAdmin: false,
      passwordNeedsReset: false,
    };
    mockState.session = { userId: 'user-1', expiresAt: Date.now() + 60_000, revoked: false };
    mockState.claims = { role: 'teacher', roles: ['teacher'], tenantId: 'school-a' };
    verifyAccessToken.mockReturnValue({ userId: 'user-1', tenantId: 'school-a', sessionId: 'session-1', roles: ['school_authority'] });
  });

  it('uses current Firestore roles instead of stale JWT roles', async () => {
    const { req, res, next } = requestContext();
    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.roles).toEqual(['teacher']);
    expect(req.user.roles).not.toContain('school_authority');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects revoked Firestore sessions immediately', async () => {
    mockState.session.revoked = true;
    const { req, res, next } = requestContext();
    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when current Firestore roles no longer match Firebase claims', async () => {
    mockState.claims = { role: 'school_authority', roles: ['school_authority'], tenantId: 'school-a' };
    const { req, res, next } = requestContext();
    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not accept a raw Firebase ID token as an app session token', async () => {
    const firebaseAdmin = require('../../../firebase.admin');
    verifyAccessToken.mockImplementationOnce(() => { throw new Error('not an app access token'); });
    firebaseAdmin.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-user-1',
      email: 'teacher@example.test',
      email_verified: true,
      tenantId: 'school-a',
      role: 'teacher',
      roles: ['teacher'],
    });
    const { req, res, next } = requestContext();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(firebaseAdmin.verifyIdToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});