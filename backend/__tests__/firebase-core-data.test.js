const mockSet = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn();
const mockTenantDocument = { set: mockSet, get: mockGet };
const mockTransaction = {
  get: mockGet,
  update: mockUpdate,
};
const mockFirestore = {
  collection: jest.fn(() => ({
    doc: jest.fn(() => mockTenantDocument),
    where: jest.fn(() => ({
      get: jest.fn(async () => ({
        docs: [{ ref: { id: 'session-1' } }],
      })),
    })),
  })),
  runTransaction: jest.fn((callback) => callback(mockTransaction)),
  batch: jest.fn(() => ({
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  })),
};

jest.mock('../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockFirestore,
}));

const firebaseCore = require('../firebase.core');

describe('Firebase core document writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sanitizes nested undefined values before writing a tenant document', async () => {
    const examResults = [{ subject: 'Mathematics', score: undefined }];
    const updates = {
      example: { examResults: undefined },
      examResults,
    };

    const saved = await firebaseCore.saveTenant('example', updates);

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      schoolId: 'example',
      examResults: [{ subject: 'Mathematics' }],
    }), { merge: true });
    expect(mockSet.mock.calls[0][0].example).toEqual({});
    expect(saved.example).toEqual({});
    expect(examResults[0].score).toBeUndefined();
  });

  test('clears all refresh sessions associated with a deleted user', async () => {
    await expect(firebaseCore.deleteSessionsForUser('school-a:student@example.test')).resolves.toBe(1);

    expect(mockFirestore.collection).toHaveBeenCalledWith('authSessions');
    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('updates an existing account document transactionally and reports missing records', async () => {
    mockGet.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });

    await expect(firebaseCore.updateById('users', 'school-a:user', { status: 'deletion_pending' }))
      .resolves.toBe(true);
    await expect(firebaseCore.updateById('users', 'school-a:missing', { status: 'deletion_pending' }))
      .resolves.toBe(false);

    expect(mockFirestore.runTransaction).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith(mockTenantDocument, expect.objectContaining({
      status: 'deletion_pending',
      updatedAt: expect.any(String),
    }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
