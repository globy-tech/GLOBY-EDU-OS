jest.mock('../../../firebase.admin', () => ({
  getUserByEmail: jest.fn(),
  getUser: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  generateEmailVerificationLink: jest.fn(),
  generatePasswordResetLink: jest.fn(),
}));

jest.mock('../../../config/app-url.config', () => ({
  getAppUrl: jest.fn(() => 'https://globyedu.test'),
}));

jest.mock('../../auth/utils/email', () => ({
  sendEmail: jest.fn(),
  teacherAccountSetupTemplate: jest.fn(() => '<p>Set up account</p>'),
}));

jest.mock('../../auth/auth.service', () => ({
  createTeacherInvitationPasswordToken: jest.fn(async () => 'teacher-setup-token'),
  revokeTeacherInvitationPasswordToken: jest.fn(async () => true),
}));

const firebaseAdmin = require('../../../firebase.admin');
const firebaseCore = require('../../../firebase.core');
const appUrlConfig = require('../../../config/app-url.config');
const email = require('../../auth/utils/email');
const invitationTokens = require('../../auth/auth.service');
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
  appUrlConfig.getAppUrl.mockReturnValue('https://globyedu.test');
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockImplementation(async () => school());
  jest.spyOn(firebaseCore, 'createById').mockResolvedValue({});
  jest.spyOn(firebaseCore, 'saveById').mockResolvedValue({});
  jest.spyOn(firebaseCore, 'deleteById').mockResolvedValue();
  firebaseAdmin.getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
  firebaseAdmin.getUser.mockResolvedValue({
    uid: 'firebase-teacher-uid',
    email: 'teacher@example.test',
    emailVerified: false,
    disabled: false,
  });
  firebaseAdmin.createUser.mockResolvedValue({ uid: 'firebase-teacher-uid' });
  firebaseAdmin.deleteUser.mockResolvedValue();
  firebaseAdmin.generateEmailVerificationLink.mockResolvedValue('https://firebase.test/verify');
  firebaseAdmin.generatePasswordResetLink.mockResolvedValue('https://firebase.test/reset');
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterEach(() => jest.restoreAllMocks());

describe('Firebase teacher account provisioning', () => {
  test('creates an Auth account and tenant-linked Firestore records before sending setup links', async () => {
    appUrlConfig.getAppUrl.mockReturnValue('https://globyedu.test/');
    const result = await schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
      assignedClasses: ['class-1'],
    }, { tenantId: schoolId, roles: ['school_authority'] });

    expect(firebaseAdmin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'teacher@example.test',
      displayName: 'Synthetic Teacher',
      password: expect.any(String),
      emailVerified: false,
    }));
    expect(firebaseCore.createById).toHaveBeenCalledWith('teachers', expect.stringContaining(`${schoolId}:`), expect.objectContaining({
      schoolId,
      email: 'teacher@example.test',
      teacherId: expect.stringMatching(/^T-[A-F0-9]{8}$/),
      firebaseUid: 'firebase-teacher-uid',
      emailVerified: false,
      invitationStatus: 'created',
      invitationEmailStatus: 'unknown',
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
    expect(firebaseAdmin.generateEmailVerificationLink).toHaveBeenCalledWith(
      'teacher@example.test',
      { url: 'https://globyedu.test/#/login' },
    );
    expect(firebaseAdmin.generatePasswordResetLink).not.toHaveBeenCalled();
    expect(invitationTokens.createTeacherInvitationPasswordToken).toHaveBeenCalledWith({
      userId: `${schoolId}:teacher@example.test`,
      schoolId,
      teacherId: result.teacherId,
      email: 'teacher@example.test',
    });
    expect(email.teacherAccountSetupTemplate).toHaveBeenCalledWith(expect.objectContaining({
      verificationLink: 'https://firebase.test/verify',
      passwordResetLink: 'https://globyedu.test/#/reset-password?type=teacher&token=teacher-setup-token',
    }));
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.emailVerified).toBe(false);
    expect(result).toMatchObject({
      invitationStatus: 'pending',
      invitationEmailStatus: 'provider_accepted',
      invitationEmailDeliveryStatus: 'unconfirmed',
      invitationEmailProvider: null,
    });
    expect(firebaseCore.saveById).toHaveBeenCalledWith('users', `${schoolId}:teacher@example.test`, expect.objectContaining({
      invitationEmailStatus: 'provider_accepted',
      invitationEmailDeliveryStatus: 'unconfirmed',
    }), true);
  });

  test('refuses an existing Firebase Auth account without changing it', async () => {
    firebaseAdmin.getUserByEmail.mockResolvedValue({ uid: 'existing-account' });

    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Existing Teacher',
      email: 'existing@example.test',
    }, { tenantId: schoolId, roles: ['school_authority'] })).rejects.toThrow(/already has a Firebase Authentication account/i);

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
    }, { tenantId: schoolId, roles: ['school_authority'] })).rejects.toThrow(/already exists in this school/i);

    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
  });

  test('rejects teacher creation when the School Authority belongs to another tenant', async () => {
    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
    }, { tenantId: 'another-school', roles: ['school_authority'] })).rejects.toThrow(/school does not match/i);

    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('allows duplicate teacher names and assigns distinct teacher IDs', async () => {
    const sharedSchool = school();
    firebaseCore.getSchoolAggregate.mockResolvedValue(sharedSchool);
    firebaseAdmin.createUser
      .mockResolvedValueOnce({ uid: 'firebase-teacher-uid-1' })
      .mockResolvedValueOnce({ uid: 'firebase-teacher-uid-2' });

    const first = await schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Alex Teacher',
      email: 'alex.one@example.test',
    }, { tenantId: schoolId, roles: ['school_authority'] });
    const second = await schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Alex Teacher',
      email: 'alex.two@example.test',
    }, { tenantId: schoolId, roles: ['school_authority'] });

    expect(first.fullName).toBe(second.fullName);
    expect(first.teacherId).not.toBe(second.teacherId);
  });

  test('does not create Firestore records when Firebase Auth account creation fails', async () => {
    firebaseAdmin.createUser.mockRejectedValue(new Error('Firebase Auth unavailable'));

    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
    }, { tenantId: schoolId, roles: ['school_authority'] })).rejects.toThrow(/Firebase Auth unavailable/);

    expect(firebaseCore.createById).not.toHaveBeenCalled();
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
  });

  test('keeps the teacher account and records a failed invitation when email sending fails', async () => {
    email.sendEmail.mockResolvedValue({ ok: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' });

    const result = await schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
    }, { tenantId: schoolId, roles: ['school_authority'] });

    expect(result).toMatchObject({
      invitationStatus: 'failed',
      invitationEmailStatus: 'failed',
      invitationEmailDeliveryStatus: 'not_sent',
      invitationEmailFailureReason: 'EMAIL_PROVIDER_NOT_CONFIGURED',
    });
    expect(firebaseCore.deleteById).not.toHaveBeenCalled();
    expect(firebaseAdmin.deleteUser).not.toHaveBeenCalled();
    expect(firebaseCore.saveById).toHaveBeenCalledWith('users', `${schoolId}:teacher@example.test`, expect.objectContaining({
      invitationStatus: 'failed',
      invitationEmailStatus: 'failed',
    }), true);

    firebaseAdmin.getUserByEmail.mockResolvedValue({ uid: 'firebase-teacher-uid' });
    await expect(schoolService.createEntity(schoolId, 'teachers', {
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
    }, { tenantId: schoolId, roles: ['school_authority'] })).rejects.toThrow(/already has a Firebase Authentication account/i);
    expect(firebaseAdmin.createUser).toHaveBeenCalledTimes(1);
  });

  test('resends an invitation for the linked pending teacher without creating another Auth user', async () => {
    const teacher = {
      id: `${schoolId}:T-ABC12345`,
      schoolId,
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-teacher-uid',
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
      status: 'active',
      invitationStatus: 'pending',
    };
    const user = {
      id: `${schoolId}:teacher@example.test`,
      schoolId,
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-teacher-uid',
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
      role: 'teacher',
      roles: ['teacher'],
      status: 'active',
    };
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [user] : [teacher]
    ));
    jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue({ name: 'Test School' });

    const result = await schoolService.resendFirebaseTeacherInvitation(schoolId, teacher.teacherId, {
      tenantId: schoolId,
      roles: ['school_authority'],
    });

    expect(result.invitationStatus).toBe('pending');
    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
    expect(firebaseAdmin.generateEmailVerificationLink).toHaveBeenCalled();
    expect(firebaseAdmin.generatePasswordResetLink).not.toHaveBeenCalled();
    expect(invitationTokens.createTeacherInvitationPasswordToken).toHaveBeenCalledWith({
      userId: user.id,
      schoolId,
      teacherId: teacher.teacherId,
      email: user.email,
    });
    expect(email.sendEmail).toHaveBeenCalledWith('teacher@example.test', expect.any(String), '<p>Set up account</p>');
    expect(firebaseCore.saveById).toHaveBeenCalledWith('users', user.id, expect.objectContaining({
      invitationStatus: 'pending',
    }), true);
  });

  test('rejects invitation resend across tenant boundaries', async () => {
    const listBySchoolSpy = jest.spyOn(firebaseCore, 'listBySchool');

    await expect(schoolService.resendFirebaseTeacherInvitation(schoolId, 'T-ABC12345', {
      tenantId: 'another-school',
      roles: ['school_authority'],
    })).rejects.toThrow(/does not match the authenticated account/i);

    expect(listBySchoolSpy).not.toHaveBeenCalled();
    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
  });

  test('does not resend an invitation for an already activated account', async () => {
    const teacher = {
      id: `${schoolId}:T-ABC12345`,
      schoolId,
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-teacher-uid',
      email: 'teacher@example.test',
      status: 'active',
      invitationStatus: 'pending',
    };
    const user = {
      id: `${schoolId}:teacher@example.test`,
      schoolId,
      teacherId: teacher.teacherId,
      firebaseUid: teacher.firebaseUid,
      email: teacher.email,
      role: 'teacher',
      roles: ['teacher'],
      status: 'active',
    };
    firebaseAdmin.getUser.mockResolvedValue({
      uid: 'firebase-teacher-uid',
      email: 'teacher@example.test',
      emailVerified: true,
      disabled: false,
    });
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [user] : [teacher]
    ));
    jest.spyOn(firebaseCore, 'saveById').mockResolvedValue({});

    const result = await schoolService.resendFirebaseTeacherInvitation(schoolId, teacher.teacherId, {
      tenantId: schoolId,
      roles: ['school_authority'],
    });

    expect(result.invitationStatus).toBe('activated');
    expect(firebaseAdmin.generateEmailVerificationLink).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('records a failed resend and keeps the existing teacher account available for another retry', async () => {
    const teacher = {
      id: `${schoolId}:T-ABC12345`,
      schoolId,
      teacherId: 'T-ABC12345',
      firebaseUid: 'firebase-teacher-uid',
      fullName: 'Synthetic Teacher',
      email: 'teacher@example.test',
      status: 'active',
    };
    const user = {
      id: `${schoolId}:teacher@example.test`,
      schoolId,
      teacherId: teacher.teacherId,
      firebaseUid: teacher.firebaseUid,
      fullName: teacher.fullName,
      email: teacher.email,
      role: 'teacher',
      roles: ['teacher'],
      status: 'active',
    };
    jest.spyOn(firebaseCore, 'listBySchool').mockImplementation(async (collection) => (
      collection === 'users' ? [user] : [teacher]
    ));
    jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue({ name: 'Test School' });
    email.sendEmail.mockResolvedValue({ ok: false, reason: 'BREVO_API_ERROR' });

    await expect(schoolService.resendFirebaseTeacherInvitation(schoolId, teacher.teacherId, {
      tenantId: schoolId,
      roles: ['school_authority'],
    })).rejects.toThrow(/account remains available for a safe retry/i);

    expect(firebaseCore.saveById).toHaveBeenCalledWith('users', user.id, expect.objectContaining({
      invitationStatus: 'failed',
      invitationEmailStatus: 'failed',
      invitationEmailFailureReason: 'BREVO_API_ERROR',
    }), true);
    expect(firebaseAdmin.createUser).not.toHaveBeenCalled();
  });
});
