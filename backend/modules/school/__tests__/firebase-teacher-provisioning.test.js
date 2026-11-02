jest.mock('../../../firebase.admin', () => ({
  getUserByEmail: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  generateEmailVerificationLink: jest.fn(),
  generatePasswordResetLink: jest.fn(),
}));

jest.mock('../../auth/utils/email', () => ({
  sendEmail: jest.fn(),
  teacherAccountSetupTemplate: jest.fn(() => '<p>Set up account</p>'),
}));

const firebaseAdmin = require('../../../firebase.admin');
const firebaseCore = require('../../../firebase.core');
const email = require('../../auth/utils/email');
const schoolService = require('../school.service');

const schoolId = 'test-school';
const school = () => ({
  id: schoolId,
  schoolId,
  name: 'Test School',
  users: [],
  teachers: [],
  students: [],
  classes: [],
  enrollments: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockImplementation(async () => school());
  jest.spyOn(firebaseCore, 'createById').mockResolvedValue({});
  jest.spyOn(firebaseCore, 'saveById').mockResolvedValue({});
  jest.spyOn(firebaseCore, 'deleteById').mockResolvedValue();
  firebaseAdmin.getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
  firebaseAdmin.createUser.mockResolvedValue({ uid: 'firebase-teacher-uid' });
  firebaseAdmin.deleteUser.mockResolvedValue();
  firebaseAdmin.generateEmailVerificationLink.mockResolvedValue('https://firebase.test/verify');
  firebaseAdmin.generatePasswordResetLink.mockResolvedValue('https://firebase.test/reset');
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterEach(() => jest.restoreAllMocks());

describe('Firebase teacher account provisioning', () => {
  test('creates an Auth account and tenant-linked Firestore records before sending setup links', async () => {
    const result = await schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
      assignedClasses: ['class-1'],
    }, { roles: ['school_authority'] });

    expect(firebaseAdmin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'teacher@example.test',
      displayName: 'Synthetic Teacher',
      password: expect.any(String),
      emailVerified: false,
    }));
    expect(firebaseCore.createById).toHaveBeenCalledWith('teachers', expect.stringContaining(`${schoolId}:`), expect.objectContaining({
      schoolId,
      email: 'teacher@example.test',
      emailVerified: false,
    }));
    expect(firebaseCore.createById).toHaveBeenCalledWith('users', `${schoolId}:teacher@example.test`, expect.objectContaining({
      schoolId,
      tenantId: schoolId,
      firebaseUid: 'firebase-teacher-uid',
      role: 'teacher',
      roles: ['teacher'],
      isVerified: false,
      emailVerified: false,
    }));
    expect(email.sendEmail).toHaveBeenCalledWith(
      'teacher@example.test',
      expect.any(String),
      '<p>Set up account</p>',
    );
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.emailVerified).toBe(false);
  });

  test('refuses an existing Firebase Auth account without changing it', async () => {
    firebaseAdmin.getUserByEmail.mockResolvedValue({ uid: 'existing-account' });

    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Existing Teacher',
      email: 'existing@example.test',
    }, { roles: ['school_authority'] })).rejects.toThrow(/already has a Firebase Authentication account/i);

    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
    expect(firebaseCore.createById).not.toHaveBeenCalled();
  });

  test('refuses an existing school-linked email without creating an Auth account', async () => {
    firebaseCore.getSchoolAggregate.mockResolvedValueOnce({
      ...school(),
      users: [{ email: 'teacher@example.test', role: 'teacher' }],
    });

    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Existing Teacher',
      email: 'teacher@example.test',
    }, { roles: ['school_authority'] })).rejects.toThrow(/already exists in this school/i);

    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
  });

  test('does not create Firestore records when Firebase Auth account creation fails', async () => {
    firebaseAdmin.createUser.mockRejectedValue(new Error('Firebase Auth unavailable'));

    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
    }, { roles: ['school_authority'] })).rejects.toThrow(/Firebase Auth unavailable/);

    expect(firebaseCore.createById).not.toHaveBeenCalled();
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
  });

  test('rolls back newly created records and Auth account if setup email is not delivered', async () => {
    email.sendEmail.mockResolvedValue({ ok: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' });

    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
    }, { roles: ['school_authority'] })).rejects.toThrow(/account setup failed/i);

    expect(firebaseCore.deleteById).toHaveBeenCalledWith('users', `${schoolId}:teacher@example.test`);
    expect(firebaseCore.deleteById).toHaveBeenCalledWith('teachers', expect.stringContaining(`${schoolId}:`));
    expect(firebaseAdmin.deleteUser).toHaveBeenCalledWith('firebase-teacher-uid');
  });
});
