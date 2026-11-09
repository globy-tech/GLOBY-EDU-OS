jest.mock('../../../firebase.admin', () => ({
  isFirebaseConfigured: jest.fn(() => true),
  verifyIdToken: jest.fn(async () => ({ uid: 'google-uid-1', email: 'teacher@globy.test', email_verified: true })),
}));

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: jest.fn(() => true),
  getFirestore: () => ({
    collection: () => ({ doc: (id) => ({ id, path: `mock/${id}` }) }),
    runTransaction: async (callback) => callback({
      get: async () => ({ exists: true, data: () => ({ status: 'active', activeSessionIds: [] }) }),
      create: jest.fn(),
      update: jest.fn(),
    }),
  }),
}));

jest.mock('../../../firebase.core', () => ({
  getTenant: jest.fn(async () => ({ id: 'globy-school', schoolId: 'globy-school', schoolStatus: 'active' })),
  listBySchool: jest.fn(async () => [
    {
      id: 'teacher-1',
      schoolId: 'globy-school',
      email: 'teacher@globy.test',
      teacherId: 'T001',
      role: 'teacher',
      status: 'active',
      firebaseUid: 'google-uid-1',
      passwordNeedsReset: false,
    },
  ]),
  saveById: jest.fn(async (collection, id, data) => ({
    id,
    schoolId: 'globy-school',
    email: 'teacher@globy.test',
    teacherId: 'T001',
    role: 'teacher',
    status: 'active',
    ...data,
  })),
  getById: jest.fn(async () => ({
    id: 'teacher-1',
    schoolId: 'globy-school',
    email: 'teacher@globy.test',
    teacherId: 'T001',
    firebaseUid: 'google-uid-1',
    role: 'teacher',
    status: 'active',
  })),
}));

jest.mock('../../../config/prisma.client', () => ({ __stub: true }));

const authService = require('../auth.service');
const firebaseAdmin = require('../../../firebase.admin');
const firebaseCore = require('../../../firebase.core');

describe('Firebase Google account linking', () => {
  test('links an existing teacher by tenant, identifier, role, and verified Google email', async () => {
    const result = await authService.loginWithFirebaseIdToken('google-token', 'globy-school', {
      identifier: 'T001',
      loginType: 'teacher',
    });

    expect(result.schoolId).toBe('globy-school');
    expect(result.user.id).toBe('teacher-1');
    expect(firebaseCore.saveById).toHaveBeenCalledWith('users', 'teacher-1', expect.objectContaining({
      firebaseUid: 'google-uid-1',
      emailVerified: true,
      invitationStatus: 'activated',
    }), true);
  });

  test('rejects a Google token when the identifier belongs to another role', async () => {
    await expect(authService.loginWithFirebaseIdToken('google-token', 'globy-school', {
      identifier: 'T001',
      loginType: 'student',
    })).rejects.toThrow(/account not recognized/i);
  });

  test('rejects linking a Google identity already owned by another user', async () => {
    firebaseCore.listBySchool.mockResolvedValueOnce([
      { id: 'teacher-1', schoolId: 'globy-school', status: 'active' },
      { id: 'student-1', schoolId: 'globy-school', firebaseUid: 'google-uid-1', status: 'active' },
    ]);

    await expect(authService.linkFirebaseIdentity('google-token', 'teacher-1', 'globy-school'))
      .rejects.toThrow(/already linked/i);
  });
});
