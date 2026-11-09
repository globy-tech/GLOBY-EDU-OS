const crypto = require('crypto');
const firebaseCore = require('../../../firebase.core');
const firebaseAdmin = require('../../../firebase.admin');
const schoolService = require('../school.service');

jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => true }));
jest.mock('../../../firebase.core', () => ({
  isFirebaseCoreMode: jest.fn(() => true),
  getSchoolAggregate: jest.fn(),
  getById: jest.fn(),
  createById: jest.fn(),
  saveById: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  deleteSessionsForUser: jest.fn(),
}));
jest.mock('../../../firebase.admin', () => ({
  deleteUser: jest.fn(),
}));
jest.mock('../../../config/prisma.client', () => null);

const SCHOOL_ID = 'firebase-account-school';
const teacherRecord = {
  id: `${SCHOOL_ID}:teacher@example.test`,
  teacherId: 'T-100',
  username: 'teacher@example.test',
  email: 'teacher@example.test',
  role: 'teacher',
  status: 'active',
  profilePhotoPath: 'teacher-profile/T-100.png',
};
const userRecord = {
  id: `${SCHOOL_ID}:teacher@example.test`,
  schoolId: SCHOOL_ID,
  tenantId: SCHOOL_ID,
  teacherId: 'T-100',
  username: 'teacher@example.test',
  email: 'teacher@example.test',
  firebaseUid: 'firebase-teacher-uid',
  role: 'teacher',
  status: 'active',
};
const authority = {
  userId: `${SCHOOL_ID}:authority@example.test`,
  tenantId: SCHOOL_ID,
  roles: ['school_authority'],
};

let aggregate;
let jobs;
let documents;

function deletionJobId(entityType, requestedEntityId) {
  return crypto.createHash('sha256')
    .update(`${SCHOOL_ID}\0${entityType}\0${String(requestedEntityId).trim().toLowerCase()}`)
    .digest('hex');
}

describe('Firebase account deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    aggregate = {
      schoolId: SCHOOL_ID,
      teachers: [{ ...teacherRecord }],
      students: [],
      users: [{ ...userRecord }],
    };
    jobs = new Map();
    documents = new Map([
      [`users:${userRecord.id}`, { ...userRecord }],
    ]);

    firebaseCore.getSchoolAggregate.mockImplementation(async () => aggregate);
    firebaseCore.getById.mockImplementation(async (collection, id) => {
      if (collection === 'accountDeletionJobs') return jobs.get(id) || null;
      return documents.get(`${collection}:${id}`) || null;
    });
    firebaseCore.createById.mockImplementation(async (collection, id, data) => {
      if (jobs.has(id)) throw Object.assign(new Error('Already exists'), { code: 6 });
      jobs.set(id, { ...data, id });
      return jobs.get(id);
    });
    firebaseCore.saveById.mockImplementation(async (collection, id, data) => {
      const current = collection === 'accountDeletionJobs' ? jobs.get(id) || {} : {};
      const saved = { ...current, ...data, id };
      if (collection === 'accountDeletionJobs') jobs.set(id, saved);
      return saved;
    });
    firebaseCore.updateById.mockImplementation(async (collection, id, updates) => {
      const key = `${collection}:${id}`;
      const current = documents.get(key);
      if (!current) return false;
      documents.set(key, { ...current, ...updates });
      return true;
    });
    firebaseCore.deleteById.mockImplementation(async (collection, id) => {
      documents.delete(`${collection}:${id}`);
      if (collection === 'teachers') {
        aggregate.teachers = aggregate.teachers.filter((record) => record.id !== id);
      }
      if (collection === 'users') {
        aggregate.users = aggregate.users.filter((record) => record.id !== id);
      }
    });
    firebaseCore.deleteSessionsForUser.mockResolvedValue(1);
    firebaseAdmin.deleteUser.mockResolvedValue();
  });

  test('creates a durable job, disables the account, revokes sessions, and then removes identity records', async () => {
    const result = await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(result.accountCleanup).toMatchObject({
      status: 'completed',
      retainedFilePaths: ['teacher-profile/T-100.png'],
      completeErasure: false,
      fileRetentionStatus: 'retained_pending_policy',
    });
    expect(firebaseCore.updateById).toHaveBeenCalledWith('users', userRecord.id, {
      status: 'deletion_pending',
      deletionJobId: deletionJobId('teachers', 'T-100'),
    });
    expect(firebaseCore.deleteSessionsForUser).toHaveBeenCalledWith(userRecord.id);
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledWith('firebase-teacher-uid');
    expect(firebaseCore.deleteById).toHaveBeenNthCalledWith(1, 'teachers', teacherRecord.id);
    expect(firebaseCore.deleteById).toHaveBeenNthCalledWith(2, 'users', userRecord.id);
    expect(jobs.get(deletionJobId('teachers', 'T-100'))).toMatchObject({
      status: 'completed',
      userDocumentId: null,
      firebaseUid: null,
      r2CleanupStatus: 'retained_pending_policy',
    });
  });

  test('retries a transient Auth failure without repeating completed disable and session steps', async () => {
    firebaseAdmin.deleteUser
      .mockRejectedValueOnce(Object.assign(new Error('Auth unavailable'), { code: 'auth/internal-error' }))
      .mockResolvedValueOnce();

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('Auth unavailable');

    expect(aggregate.teachers).toHaveLength(1);
    expect(firebaseCore.deleteSessionsForUser).toHaveBeenCalledTimes(1);
    expect(jobs.get(deletionJobId('teachers', 'T-100'))).toMatchObject({
      status: 'in_progress',
      currentStep: 'authDeleted',
      lastFailureCode: 'AUTH_INTERNAL_ERROR',
    });

    await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(firebaseCore.updateById).toHaveBeenCalledTimes(1);
    expect(firebaseCore.deleteSessionsForUser).toHaveBeenCalledTimes(1);
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(2);
    expect(firebaseCore.deleteById).toHaveBeenCalledTimes(2);
  });

  test('retries transient session revocation without repeating account disablement', async () => {
    firebaseCore.deleteSessionsForUser
      .mockRejectedValueOnce(new Error('Session store unavailable'))
      .mockResolvedValueOnce(1);

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('Session store unavailable');

    expect(jobs.get(deletionJobId('teachers', 'T-100'))).toMatchObject({
      status: 'in_progress',
      currentStep: 'sessionsRevoked',
    });
    expect(firebaseCore.updateById).toHaveBeenCalledTimes(1);
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();

    await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(firebaseCore.updateById).toHaveBeenCalledTimes(1);
    expect(firebaseCore.deleteSessionsForUser).toHaveBeenCalledTimes(2);
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(1);
  });

  test('surfaces journal-write failure and resumes the pending cleanup step on retry', async () => {
    firebaseCore.deleteSessionsForUser.mockRejectedValueOnce(new Error('Session store unavailable'));
    firebaseCore.saveById
      .mockImplementationOnce(async (collection, id, updates) => {
        const saved = { ...jobs.get(id), ...updates, id };
        jobs.set(id, saved);
        return saved;
      })
      .mockRejectedValueOnce(new Error('Journal store unavailable'));

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toMatchObject({
      code: 'ACCOUNT_CLEANUP_JOURNAL_WRITE_FAILED',
      journalErrorCode: 'JOURNAL_WRITE_FAILED',
    });

    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.deleteById).not.toHaveBeenCalled();

    await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(firebaseCore.deleteSessionsForUser).toHaveBeenCalledTimes(2);
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(1);
    expect(jobs.get(deletionJobId('teachers', 'T-100')).status).toBe('completed');
  });

  test('retries entity removal without repeating Auth deletion', async () => {
    firebaseCore.deleteById
      .mockRejectedValueOnce(new Error('Entity store unavailable'))
      .mockResolvedValue();

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('Entity store unavailable');

    expect(jobs.get(deletionJobId('teachers', 'T-100'))).toMatchObject({
      status: 'in_progress',
      currentStep: 'entityDeleted',
      authDeleted: true,
    });
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(1);

    await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(firebaseAdmin.deleteUser).toHaveBeenCalledTimes(1);
    expect(firebaseCore.deleteById).toHaveBeenCalledTimes(3);
  });

  test('retries user-record cleanup without repeating completed entity deletion', async () => {
    firebaseCore.deleteById.mockImplementationOnce(async (collection, id) => {
      documents.delete(`${collection}:${id}`);
      aggregate.teachers = aggregate.teachers.filter((record) => record.id !== id);
    }).mockRejectedValueOnce(new Error('Firestore temporarily unavailable'))
      .mockResolvedValueOnce();

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('Firestore temporarily unavailable');

    expect(aggregate.teachers).toHaveLength(0);
    expect(aggregate.users).toHaveLength(1);

    await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(firebaseCore.deleteById).toHaveBeenCalledTimes(3);
    expect(firebaseCore.deleteById).toHaveBeenNthCalledWith(1, 'teachers', teacherRecord.id);
    expect(firebaseCore.deleteById).toHaveBeenNthCalledWith(2, 'users', userRecord.id);
    expect(firebaseCore.deleteById).toHaveBeenNthCalledWith(3, 'users', userRecord.id);
  });

  test('repeated retry after completion does not repeat destructive operations', async () => {
    await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });
    jest.clearAllMocks();
    aggregate.teachers = [];
    aggregate.users = [];

    const result = await schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    });

    expect(result.accountCleanup).toMatchObject({
      status: 'completed',
      retainedFilePaths: ['teacher-profile/T-100.png'],
      completeErasure: false,
    });
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.deleteSessionsForUser).not.toHaveBeenCalled();
    expect(firebaseCore.deleteById).not.toHaveBeenCalled();
  });

  test('treats a missing Firebase Auth identity as an already-completed cleanup step', async () => {
    firebaseAdmin.deleteUser.mockRejectedValue(Object.assign(new Error('No user'), { code: 'auth/user-not-found' }));

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).resolves.toMatchObject({ accountCleanup: { status: 'completed', completeErasure: false } });
  });

  test('resumes an approved student deletion after the student document was already removed', async () => {
    const userId = `${SCHOOL_ID}:student@example.test`;
    const jobId = deletionJobId('students', 'STU-100');
    aggregate.students = [];
    aggregate.users = [{
      id: userId,
      schoolId: SCHOOL_ID,
      tenantId: SCHOOL_ID,
      studentId: 'STU-100',
      username: 'student@example.test',
      email: 'student@example.test',
      role: 'student',
      status: 'deletion_pending',
    }];
    documents.set(`users:${userId}`, { ...aggregate.users[0] });
    jobs.set(jobId, {
      id: jobId,
      schoolId: SCHOOL_ID,
      entityType: 'students',
      requestEntityId: 'STU-100',
      targetIdentifier: 'STU-100',
      status: 'in_progress',
      entityDocumentId: `${SCHOOL_ID}:STU-100`,
      userDocumentId: userId,
      firebaseUid: null,
      userDisabled: true,
      sessionsRevoked: true,
      authDeleted: true,
      entityDeleted: true,
      userDeleted: false,
      retainedFilePaths: ['student-profile/STU-100.png'],
    });

    await expect(schoolService.resolveStudentDeletionRequest(
      SCHOOL_ID,
      'STU-100',
      'approved',
      'STU-100',
      authority,
    )).resolves.toMatchObject({
      studentId: 'STU-100',
      status: 'approved',
      accountCleanup: { status: 'completed', completeErasure: false },
    });

    expect(firebaseCore.deleteById).toHaveBeenCalledTimes(1);
    expect(firebaseCore.deleteById).toHaveBeenCalledWith('users', userId);
  });

  test('rejects cross-tenant access and missing permanent-delete confirmation without side effects', async () => {
    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', {
      ...authority,
      tenantId: 'another-school',
    }, { confirmation: 'T-100' })).rejects.toThrow('Tenant mismatch');
    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority))
      .rejects.toThrow('Type the teacher ID to confirm permanent deletion.');
    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'WRONG-ID',
    })).rejects.toThrow('Type the teacher ID to confirm permanent deletion.');

    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.createById).not.toHaveBeenCalled();
    expect(firebaseCore.deleteById).not.toHaveBeenCalled();
  });

  test('does not continue when the account record cannot be disabled', async () => {
    firebaseCore.updateById.mockResolvedValue(false);

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('Account record could not be disabled before deletion.');

    expect(firebaseCore.deleteSessionsForUser).not.toHaveBeenCalled();
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.deleteById).not.toHaveBeenCalled();
    expect(jobs.get(deletionJobId('teachers', 'T-100'))).toMatchObject({
      status: 'in_progress',
      currentStep: 'userDisabled',
    });
  });

  test('refuses to delete an account whose current Firestore user record belongs to another tenant', async () => {
    aggregate.users[0].tenantId = 'another-school';

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('Account tenant does not match the requested school.');

    expect(firebaseCore.updateById).not.toHaveBeenCalled();
    expect(firebaseCore.deleteSessionsForUser).not.toHaveBeenCalled();
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.createById).not.toHaveBeenCalled();
  });

  test('does not reuse a completed cleanup job for a recreated account identifier', async () => {
    jobs.set(deletionJobId('teachers', 'T-100'), {
      id: deletionJobId('teachers', 'T-100'),
      schoolId: SCHOOL_ID,
      entityType: 'teachers',
      targetIdentifier: 'T-100',
      status: 'completed',
    });

    await expect(schoolService.deleteEntity(SCHOOL_ID, 'teachers', 'T-100', authority, {
      confirmation: 'T-100',
    })).rejects.toThrow('A previously deleted account with this identifier has been recreated.');

    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.deleteById).not.toHaveBeenCalled();
  });
});

describe('Prisma account deletion confirmation', () => {
  test.each([undefined, 'WRONG-ID'])('rejects confirmation %s before Prisma account deletion', async (confirmation) => {
    jest.resetModules();
    const tenant = {
      id: SCHOOL_ID,
      schoolId: SCHOOL_ID,
      users: [{
        id: teacherRecord.id,
        tenantId: SCHOOL_ID,
        email: teacherRecord.email,
        status: 'active',
        roles: [{ role: { name: 'teacher' } }],
        metadata: {
          teacherId: teacherRecord.teacherId,
          profilePhotoPath: teacherRecord.profilePhotoPath,
        },
      }],
    };
    const prisma = {
      __stub: false,
      tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
      user: { findFirst: jest.fn() },
      userRole: {
        deleteMany: jest.fn(),
        count: jest.fn(),
      },
    };
    jest.doMock('../../../config/prisma.client', () => prisma);

    const isolatedSchoolService = require('../school.service');
    const isolatedFirebaseCore = require('../../../firebase.core');
    isolatedFirebaseCore.isFirebaseCoreMode.mockReturnValue(false);

    await expect(isolatedSchoolService.deleteEntity(
      SCHOOL_ID,
      'teachers',
      'T-100',
      authority,
      { confirmation },
    )).rejects.toThrow('Type the teacher ID to confirm permanent deletion.');

    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });
});
