const mockState = {
  collections: new Map(),
  firestore: null,
};

function collectionRecords(name) {
  if (!mockState.collections.has(name)) mockState.collections.set(name, new Map());
  return mockState.collections.get(name);
}

function documentReference(collection, id) {
  return { collection, id: String(id) };
}

function snapshot(reference, record) {
  return {
    exists: Boolean(record),
    id: reference.id,
    data: () => (record ? structuredClone(record) : undefined),
  };
}

mockState.firestore = {
  collection(name) {
    return {
      doc(id) {
        return documentReference(name, id);
      },
      where(field, operator, value) {
        return {
          get: async () => ({
            docs: Array.from(collectionRecords(name).entries())
              .filter(([, record]) => operator === '==' && record[field] === value)
              .map(([id, record]) => ({ id, data: () => structuredClone(record) })),
          }),
        };
      },
    };
  },
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (reference) => snapshot(reference, collectionRecords(reference.collection).get(reference.id)),
      create: (reference, data) => writes.push({ type: 'create', reference, data }),
      update: (reference, data) => writes.push({ type: 'update', reference, data }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const records = collectionRecords(write.reference.collection);
      const current = records.get(write.reference.id);
      if (write.type === 'create' && current) throw new Error('Document already exists');
      records.set(write.reference.id, { ...(current || {}), ...structuredClone(write.data) });
    }
    return result;
  },
};

jest.mock('../../../config/prisma.client', () => null);
jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockState.firestore,
}));
jest.mock('../../../firebase.admin', () => ({
  getUserByEmail: jest.fn(async () => ({ uid: 'firebase-user-001', email: 'teacher@example.test' })),
  updateUser: jest.fn(async () => ({})),
  revokeRefreshTokens: jest.fn(async () => undefined),
}));
jest.mock('bcrypt', () => ({
  hash: jest.fn(async (password) => `bcrypt:${password}`),
  compare: jest.fn(async (password, hash) => hash === `bcrypt:${password}` || (password === 'Current!Pass1' && hash === 'existing-hash'),
  ),
}));

const authService = require('../auth.service');
const { hashToken, verifyAccessToken } = require('../utils/token');

const USER_ID = 'school-a:teacher@example.test';
const USER_EMAIL = 'teacher@example.test';

function seedUser(overrides = {}) {
  collectionRecords('users').set(USER_ID, {
    id: USER_ID,
    email: USER_EMAIL,
    username: USER_EMAIL,
    schoolId: 'school-a',
    tenantId: 'school-a',
    roles: ['teacher'],
    role: 'teacher',
    status: 'active',
    passwordHash: 'existing-hash',
    passwordNeedsReset: true,
    firebaseUid: 'firebase-user-001',
    activeSessionIds: ['old-session'],
    ...overrides,
  });
  collectionRecords('authSessions').set('old-session', {
    userId: USER_ID,
    revoked: false,
    expiresAt: Date.now() + 60_000,
  });
}

function clearCollections() {
  mockState.collections.clear();
}

describe('Firebase password recovery with Prisma unavailable', () => {
  beforeEach(() => clearCollections());

  test('changes a temporary password using the authenticated user record and clears the first-login gate', async () => {
    seedUser();

    const session = await authService.changePassword(USER_ID, 'Current!Pass1', 'NewStrong!Pass2');
    const user = collectionRecords('users').get(USER_ID);

    expect(user.passwordHash).toBe('bcrypt:NewStrong!Pass2');
    expect(user.passwordNeedsReset).toBe(false);
    expect(user.passwordChangedAt).toEqual(expect.any(String));
    expect(user.activeSessionIds).toEqual([expect.any(String)]);
    expect(collectionRecords('authSessions').get('old-session').revoked).toBe(true);
    expect(verifyAccessToken(session.accessToken).passwordNeedsReset).toBe(false);
    expect(session.user.passwordNeedsReset).toBe(false);
    expect(require('../../../firebase.admin').updateUser).toHaveBeenCalledWith('firebase-user-001', { password: 'NewStrong!Pass2' });
    expect(require('../../../firebase.admin').revokeRefreshTokens).toHaveBeenCalledWith('firebase-user-001');
    expect(user.passwordSyncPending).toBe(false);
  });

  test('rejects a password change with an invalid current password without changing credentials', async () => {
    seedUser();
    const before = structuredClone(collectionRecords('users').get(USER_ID));

    await expect(authService.changePassword(USER_ID, 'Wrong!Pass1', 'NewStrong!Pass2'))
      .rejects.toThrow('Invalid current password');

    expect(collectionRecords('users').get(USER_ID)).toEqual(before);
    expect(collectionRecords('authSessions').get('old-session').revoked).toBe(false);
  });

  test('does not identify unknown emails or expose a reset token', async () => {
    let deliveredToken;

    await expect(authService.forgotPassword('unknown@example.test', {
      loginType: 'teacher',
      deliverResetToken: async (token) => { deliveredToken = token; },
    })).resolves.toBe(true);

    expect(deliveredToken).toBeUndefined();
    expect(collectionRecords('passwordResetTokens').size).toBe(0);
  });

  test('stores only a token hash and atomically updates password state when reset succeeds', async () => {
    seedUser();
    let deliveredToken;

    await authService.forgotPassword(USER_EMAIL, {
      loginType: 'teacher',
      deliverResetToken: async (token) => { deliveredToken = token; },
    });

    const tokenHash = hashToken(deliveredToken);
    const storedToken = collectionRecords('passwordResetTokens').get(tokenHash);
    expect(tokenHash).not.toBe(deliveredToken);
    expect(storedToken).toMatchObject({ userId: USER_ID, email: USER_EMAIL, used: false });
    expect(JSON.stringify(storedToken)).not.toContain(deliveredToken);

    await expect(authService.resetPassword(deliveredToken, 'ResetStrong!Pass3')).resolves.toBe(true);

    const user = collectionRecords('users').get(USER_ID);
    expect(user).toMatchObject({ passwordHash: 'bcrypt:ResetStrong!Pass3', passwordNeedsReset: false });
    expect(user.passwordChangedAt).toEqual(expect.any(String));
    expect(user.activeSessionIds).toEqual([]);
    expect(collectionRecords('authSessions').get('old-session').revoked).toBe(true);
    expect(collectionRecords('passwordResetTokens').get(tokenHash)).toMatchObject({ used: true });
    expect(user.passwordSyncPending).toBe(false);
    expect(require('../../../firebase.admin').updateUser).toHaveBeenCalledWith('firebase-user-001', { password: 'ResetStrong!Pass3' });
    expect(require('../../../firebase.admin').revokeRefreshTokens).toHaveBeenCalledWith('firebase-user-001');
    await expect(authService.resetPassword(deliveredToken, 'AnotherStrong!Pass4'))
      .rejects.toThrow('Invalid or expired token');
    expect(collectionRecords('users').get(USER_ID).passwordHash).toBe('bcrypt:ResetStrong!Pass3');
  });

  test('revokes the hashed reset token when email delivery fails', async () => {
    seedUser();
    let deliveredToken;

    await expect(authService.forgotPassword(USER_EMAIL, {
      loginType: 'teacher',
      deliverResetToken: async (token) => {
        deliveredToken = token;
        throw new Error('delivery failed');
      },
    })).rejects.toThrow('delivery failed');

    const storedToken = collectionRecords('passwordResetTokens').get(hashToken(deliveredToken));
    expect(storedToken).toMatchObject({ revoked: true });
    await expect(authService.resetPassword(deliveredToken, 'ResetStrong!Pass3'))
      .rejects.toThrow('Invalid or expired token');
  });

  test('keeps login blocked and does not consume the reset token if Firebase password sync fails', async () => {
    seedUser();
    let deliveredToken;
    await authService.forgotPassword(USER_EMAIL, {
      loginType: 'teacher',
      deliverResetToken: async (token) => { deliveredToken = token; },
    });
    const tokenHash = hashToken(deliveredToken);
    require('../../../firebase.admin').updateUser.mockRejectedValueOnce(new Error('Firebase update failed'));

    await expect(authService.resetPassword(deliveredToken, 'ResetStrong!Pass3'))
      .rejects.toThrow('Firebase update failed');

    expect(collectionRecords('users').get(USER_ID).passwordSyncPending).toBe(true);
    expect(collectionRecords('passwordResetTokens').get(tokenHash).used).toBe(false);
    await expect(authService.resetPassword(deliveredToken, 'ResetStrong!Pass3'))
      .rejects.toThrow('Password update is still being synchronized.');
  });

  test('rejects expired and invalid reset tokens without updating the user', async () => {
    seedUser();
    const expiredToken = 'expired-token-value';
    collectionRecords('passwordResetTokens').set(hashToken(expiredToken), {
      userId: USER_ID,
      email: USER_EMAIL,
      expiresAt: Date.now() - 1,
      used: false,
    });
    const before = structuredClone(collectionRecords('users').get(USER_ID));

    await expect(authService.resetPassword(expiredToken, 'ResetStrong!Pass3'))
      .rejects.toThrow('Invalid or expired token');
    await expect(authService.resetPassword('not-issued-token', 'ResetStrong!Pass3'))
      .rejects.toThrow('Invalid or expired token');

    expect(collectionRecords('users').get(USER_ID)).toEqual(before);
  });

  test('blocks password login when Firebase password synchronization fails', async () => {
    seedUser();
    require('../../../firebase.admin').updateUser.mockRejectedValueOnce(new Error('Firebase update failed'));

    await expect(authService.changePassword(USER_ID, 'Current!Pass1', 'NewStrong!Pass2'))
      .rejects.toThrow('Firebase update failed');

    expect(collectionRecords('users').get(USER_ID).passwordSyncPending).toBe(true);
    expect(collectionRecords('users').get(USER_ID).activeSessionIds).toEqual([]);
  });
});
