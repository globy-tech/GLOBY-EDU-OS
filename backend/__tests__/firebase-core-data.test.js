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

  test('runs class-related writes in a transaction that also updates the class record', async () => {
    const classReference = { collectionName: 'classes', id: 'school-a:class-1' };
    const writes = [];
    const transaction = {
      get: jest.fn(async (reference) => ({
        exists: reference === classReference,
        id: reference.id,
        data: () => ({ schoolId: 'school-a', classId: 'class-1', status: 'active' }),
      })),
      set: jest.fn((reference, data, options) => writes.push({ reference, data, options })),
    };
    mockFirestore.collection.mockImplementation((name) => ({
      doc: (id) => (name === 'classes' && id === classReference.id
        ? classReference
        : { collectionName: name, id: String(id) }),
      where: jest.fn(() => ({ collectionName: name })),
    }));
    mockFirestore.runTransaction.mockImplementation((callback) => callback(transaction));

    await expect(firebaseCore.runClassMutation('school-a', ['class-1'], async ({
      transaction: currentTransaction,
      classRecords,
      getDocumentReference,
    }) => {
      expect(classRecords[0]).toMatchObject({ id: classReference.id, classId: 'class-1' });
      currentTransaction.set(getDocumentReference('students', 'school-a:student-1'), { classId: 'class-1' });
      return { result: 'saved' };
    })).resolves.toBe('saved');

    expect(transaction.get).toHaveBeenCalledWith(classReference);
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: { collectionName: 'students', id: 'school-a:student-1' },
        data: { classId: 'class-1' },
      }),
      expect.objectContaining({
        reference: classReference,
        data: { updatedAt: expect.any(String) },
        options: { merge: true },
      }),
    ]));
  });

  test('serializes competing progression decisions for the same student', async () => {
    const records = new Map([
      ['students/school-a:STD-1', {
        schoolId: 'school-a',
        studentId: 'STD-1',
        classId: 'class-source',
        academicYearId: 'year-source',
        metadata: {},
      }],
      ['classes/school-a:class-source', {
        schoolId: 'school-a',
        classId: 'class-source',
        academicYearId: 'year-source',
        studentIds: ['STD-1'],
      }],
      ['classes/school-a:class-target', {
        schoolId: 'school-a',
        classId: 'class-target',
        academicYearId: 'year-target',
        studentIds: [],
      }],
      ['enrollments/school-a:enrollment-source', {
        schoolId: 'school-a',
        studentId: 'STD-1',
        academicYearId: 'year-source',
        classId: 'class-source',
        status: 'active',
        isCurrent: true,
      }],
    ]);
    let transactionQueue = Promise.resolve();
    mockFirestore.collection.mockImplementation((name) => ({
      doc: (id) => ({ collectionName: name, id: String(id) }),
      where: (field, operator, value) => ({
        collectionName: name,
        filters: [[field, operator, value]],
        where(nextField, nextOperator, nextValue) {
          this.filters.push([nextField, nextOperator, nextValue]);
          return this;
        },
      }),
    }));
    mockFirestore.runTransaction.mockImplementation((callback) => {
      const current = transactionQueue.then(async () => {
        const writes = [];
        const transaction = {
          get: async (reference) => {
            if (reference.filters) {
              const docs = [...records.entries()]
                .filter(([key, data]) => key.startsWith(`${reference.collectionName}/`)
                  && reference.filters.every(([field, , value]) => data[field] === value))
                .map(([key, data]) => ({
                  id: key.slice(reference.collectionName.length + 1),
                  ref: { collectionName: reference.collectionName, id: key.slice(reference.collectionName.length + 1) },
                  data: () => data,
                }));
              return { docs };
            }
            const data = records.get(`${reference.collectionName}/${reference.id}`);
            return { exists: Boolean(data), data: () => data };
          },
          set: (reference, data) => writes.push([reference, data]),
        };
        const result = await callback(transaction);
        writes.forEach(([reference, data]) => {
          records.set(`${reference.collectionName}/${reference.id}`, {
            ...(records.get(`${reference.collectionName}/${reference.id}`) || {}),
            ...data,
          });
        });
        return result;
      });
      transactionQueue = current.catch(() => {});
      return current;
    });

    const progression = {
      schoolId: 'school-a',
      studentId: 'STD-1',
      fromAcademicYearId: 'year-source',
      sourceClassId: 'class-source',
      targetAcademicYearId: 'year-target',
      targetClassId: 'class-target',
      operationId: 'progression-op-1',
      action: 'promote',
      student: {
        schoolId: 'school-a',
        studentId: 'STD-1',
        classId: 'class-target',
        academicYearId: 'year-target',
        metadata: { progressionHistory: [{
          operationId: 'progression-op-1',
          action: 'promote',
          fromAcademicYearId: 'year-source',
          toAcademicYearId: 'year-target',
          toClassId: 'class-target',
        }] },
      },
      targetEnrollment: {
        id: 'STD-1:year-target:class-target',
        studentId: 'STD-1',
        classId: 'class-target',
        academicYearId: 'year-target',
        status: 'active',
        isCurrent: true,
      },
    };

    const results = await Promise.allSettled([
      firebaseCore.commitAcademicProgression(progression),
      firebaseCore.commitAcademicProgression({ ...progression, operationId: 'progression-op-2' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(records.get('students/school-a:STD-1').classId).toBe('class-target');
    expect(records.get('classes/school-a:class-source').studentIds).toEqual([]);
    expect(records.get('classes/school-a:class-target').studentIds).toEqual(['STD-1']);
    expect(records.get('enrollments/school-a:STD-1:year-target:class-target')).toMatchObject({
      schoolId: 'school-a',
      isCurrent: true,
    });
  });
});
