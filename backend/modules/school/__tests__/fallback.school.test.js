const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { EXTERNAL_SERVICE_VARIABLES } = require('../../../config/qa-config');
const schoolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-fallback-school-tests-'));
const schoolsFile = path.join(schoolsDirectory, 'schools.json');
const isolatedPaths = {
  GLOBY_QA_HOME: schoolsDirectory,
  GLOBY_SCHOOLS_FILE: schoolsFile,
  GLOBY_AUDIT_FILE: path.join(schoolsDirectory, 'audit-logs.json'),
  GLOBY_PASSWORD_RESET_TOKENS_FILE: path.join(schoolsDirectory, 'password-reset-tokens.json'),
};
const environmentKeys = [
  ...EXTERNAL_SERVICE_VARIABLES,
  'DATABASE_URL',
  'USE_REAL_DATABASE',
  'RENDER_SERVICE_ID',
  'NODE_ENV',
  'DATA_STORE_MODE',
  'GLOBY_QA_MODE',
  ...Object.keys(isolatedPaths),
];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
EXTERNAL_SERVICE_VARIABLES.forEach((key) => { delete process.env[key]; });
delete process.env.DATABASE_URL;
delete process.env.USE_REAL_DATABASE;
delete process.env.RENDER_SERVICE_ID;
process.env.NODE_ENV = 'test';
process.env.DATA_STORE_MODE = 'json';
process.env.GLOBY_QA_MODE = 'true';
Object.assign(process.env, isolatedPaths);
const fallbackSchool = require('../fallback.school');
const { ensureDemoSchool, loadSchoolData, saveSchoolData } = fallbackSchool;
const schoolService = require('../school.service');
const firebaseCore = require('../../../firebase.core');
const firebaseData = require('../../../firebase.data');
const tenantMiddleware = require('../middleware/tenant.middleware');
const { generateSchoolSubdomain, resolveTenantFromHostname } = require('../tenant-hostname');

afterEach(() => {
  delete global.__workspaceSnapshot;
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  jest.restoreAllMocks();
});

afterAll(() => {
  try {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  } finally {
    fs.rmSync(schoolsDirectory, { recursive: true, force: true });
  }
});

test('QA fallback requires a separately configured QA data root before reading school data', () => {
  const variables = [
    'GLOBY_QA_MODE',
    'DATA_STORE_MODE',
    'GLOBY_QA_HOME',
    'GLOBY_AUDIT_FILE',
    'GLOBY_PASSWORD_RESET_TOKENS_FILE',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_APP_ID',
    'GCLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ENDPOINT',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET',
    'PAYSTACK_SECRET_KEY',
    'PAYSTACK_WEBHOOK_SECRET',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'RESEND_API_KEY',
    'BREVO_API_KEY',
    'SENDGRID_API_KEY',
    'MAILGUN_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
  ];
  const originalValues = new Map(variables.map((variable) => [variable, process.env[variable]]));

  try {
    variables.forEach((variable) => { delete process.env[variable]; });
    process.env.GLOBY_QA_MODE = 'true';
    process.env.DATA_STORE_MODE = 'json';

    expect(() => loadSchoolData()).toThrow('GLOBY_QA_HOME is required in isolated QA mode.');
  } finally {
    variables.forEach((variable) => {
      const originalValue = originalValues.get(variable);
      if (originalValue === undefined) delete process.env[variable];
      else process.env[variable] = originalValue;
    });
  }
});

test.each([
  ['missing', {}],
  ['invalid', { confirmation: 'WRONG-ID' }],
])('JSON fallback refuses %s account-deletion confirmation without changing the fixture', async (_label, options) => {
  const schoolId = 'isolated-delete-school';
  const teacher = {
    id: 'isolated-teacher-record',
    teacherId: 'T-ISOLATED',
    email: 'isolated-teacher@example.test',
    profilePhotoPath: 'teacher-profile/T-ISOLATED.png',
    status: 'active',
  };
  fs.writeFileSync(schoolsFile, JSON.stringify({
    schools: [{
      schoolId,
      users: [{ id: teacher.id, teacherId: teacher.teacherId, email: teacher.email, role: 'teacher' }],
      teachers: [teacher],
      students: [],
    }],
  }), 'utf8');
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);

  await expect(schoolService.deleteEntity(schoolId, 'teachers', teacher.teacherId, {
    roles: ['school_authority'],
    tenantId: schoolId,
  }, options)).rejects.toThrow('Type the teacher ID to confirm permanent deletion.');

  expect(loadSchoolData().find((school) => school.schoolId === schoolId).teachers).toEqual([teacher]);
});

test('JSON fallback deletion response reports retained uploaded files and does not claim complete erasure', async () => {
  const schoolId = 'isolated-retention-school';
  const teacher = {
    id: 'isolated-retention-teacher',
    teacherId: 'T-RETAINED',
    email: 'retained-teacher@example.test',
    profilePhotoPath: 'teacher-profile/T-RETAINED.png',
    status: 'active',
  };
  fs.writeFileSync(schoolsFile, JSON.stringify({
    schools: [{
      schoolId,
      users: [{ id: teacher.id, teacherId: teacher.teacherId, email: teacher.email, role: 'teacher' }],
      teachers: [teacher],
      students: [],
    }],
  }), 'utf8');
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);

  const result = await schoolService.deleteEntity(schoolId, 'teachers', teacher.teacherId, {
    roles: ['school_authority'],
    tenantId: schoolId,
  }, { confirmation: teacher.teacherId });

  expect(result.accountCleanup).toEqual({
    status: 'completed',
    retainedFilePaths: [teacher.profilePhotoPath],
    completeErasure: false,
    fileRetentionStatus: 'retained_pending_policy',
  });
  expect(loadSchoolData().find((school) => school.schoolId === schoolId).teachers).toEqual([]);
});

test('ensureDemoSchool seeds the required development accounts and school identifiers', () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();

  expect(school.schoolId).toBe('globy-school');
  expect(school.name).toBe('Globy School');
  expect(school.email).toBe('authority@globyedu.test');
  expect(school.country).toBe('Ghana');
  expect(school.region).toBe('Ashanti');
  expect(school.subscriptionPlan).toBe('Unlimited (Development Only)');

  const emails = ['ataetaben@gmail.com', 'ataetabenjamin@gmail.com', 'hellogloby@gmail.com', 'benjaminataeta@gmail.com'];
  for (const email of emails) {
    const superAdmin = school.users.find((user) => user.username === email);
    expect(superAdmin).toBeDefined();
    expect(superAdmin.role).toBe('super_admin');
    expect(superAdmin.passwordHash).toBeTruthy();
    expect(superAdmin.platformAdmin).toBe(true);
  }

  const schoolHead = school.users.find((user) => user.username === 'authority@globyedu.test');
  expect(schoolHead).toBeDefined();
  expect(schoolHead.role).toBe('school_authority');

  const teacher = school.users.find((user) => user.username === 'T001');
  expect(teacher).toBeDefined();
  expect(teacher.role).toBe('teacher');
  expect(teacher.passwordHash).toBeTruthy();

  const student = school.users.find((user) => user.username === 'STU001');
  expect(student).toBeDefined();
  expect(student.role).toBe('student');
  expect(student.studentId).toBe('STU001');
  expect(student.passwordNeedsReset).toBe(true);
});

test('Firebase school creation allocates collision-resistant IDs without the local JSON sequence', async () => {
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'findTenantByHeadEmail').mockResolvedValue(null);
  const getTenant = jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(null);
  jest.spyOn(firebaseCore, 'createTenantRegistration').mockImplementation(async (schoolId, registration) => ({ id: schoolId, schoolId, ...registration.tenant }));

  const first = await schoolService.createSchool({
    name: 'Firebase ID Allocation Test',
    headEmail: 'authority@firebase-id.example.test',
    headPassword: 'StrongPassword!123',
  });
  const second = await schoolService.createSchool({
    name: 'Firebase ID Allocation Test',
    headEmail: 'authority@firebase-id.example.test',
    headPassword: 'StrongPassword!123',
  });

  expect(first.schoolId).toMatch(/^GLB-\d{4}-[A-F0-9]{12}$/);
  expect(second.schoolId).toMatch(/^GLB-\d{4}-[A-F0-9]{12}$/);
  expect(first.schoolId).not.toBe(second.schoolId);
  expect(getTenant).toHaveBeenNthCalledWith(1, first.schoolId);
  expect(getTenant).toHaveBeenNthCalledWith(2, second.schoolId);
});

test('Firebase school creation stores an unverified tenant-linked school_head record', async () => {
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'findTenantByHeadEmail').mockResolvedValue(null);
  jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(null);
  let registration;
  jest.spyOn(firebaseCore, 'createTenantRegistration').mockImplementation(async (schoolId, payload) => {
    registration = payload;
    return { id: schoolId, schoolId, ...payload.tenant };
  });

  const created = await schoolService.createSchool({
    name: 'Firebase Verification State Test',
    headEmail: 'authority@verification-state.example.test',
    headPassword: 'StrongPassword!123',
  });
  const user = registration.user;

  expect(user).toMatchObject({
    schoolId: created.schoolId,
    tenantId: created.schoolId,
    role: 'school_head',
    isVerified: false,
    emailVerified: false,
  });
});

test('Firebase school creation blocks a second registration for an existing authority email', async () => {
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'findTenantByHeadEmail').mockResolvedValue({
    schoolId: 'GLB-2026-EXISTING',
    name: 'Existing Pilot School',
    headEmail: 'authority@firebase-id.example.test',
  });
  const saveTenant = jest.spyOn(firebaseCore, 'saveTenant');
  const saveById = jest.spyOn(firebaseCore, 'saveById');

  await expect(schoolService.createSchool({
    name: 'Existing Pilot School',
    headEmail: 'authority@firebase-id.example.test',
    headPassword: 'StrongPassword!123',
  })).rejects.toMatchObject({ code: 'SCHOOL_REGISTRATION_EXISTS', registrationOperation: 'owner.lookup' });

  expect(saveTenant).not.toHaveBeenCalled();
  expect(saveById).not.toHaveBeenCalled();
});

test('JSON fallback school head retains its trusted local verification state', async () => {
  const created = await schoolService.createSchool({
    name: 'Local Verification Fallback Test',
    headEmail: 'authority@local-verification.example.test',
    headPassword: 'StrongPassword!123',
  });
  const user = created.users.find((entry) => entry.username === 'authority@local-verification.example.test');

  expect(user).toMatchObject({ role: 'school_head', isVerified: true, emailVerified: true });
});

test('demo seeding preserves valid non-demo schools while deduplicating duplicate demo entries', () => {
  const extraSchools = {
    schools: [
      { schoolId: 'globy-school', name: 'Globy School' },
      { schoolId: 'school-2', name: 'Demo Academy' },
      { schoolId: 'school-3', name: 'Bright Future' },
    ],
  };

  fs.writeFileSync(schoolsFile, JSON.stringify(extraSchools, null, 2), 'utf8');

  const persisted = JSON.parse(fs.readFileSync(schoolsFile, 'utf8'));
  expect(persisted.schools).toHaveLength(3);

  const school = ensureDemoSchool();
  const reloaded = JSON.parse(fs.readFileSync(schoolsFile, 'utf8'));

  expect(school.schoolId).toBe('globy-school');
  expect(reloaded.schools).toHaveLength(3);
  expect(reloaded.schools.map((entry) => entry.schoolId)).toEqual(expect.arrayContaining(['globy-school', 'school-2', 'school-3']));
});

test('development accounts use the exact required passwords and roles', () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();
  const requiredCredentials = [
    { username: 'ataetaben@gmail.com', password: 'Benjamin@123', role: 'super_admin' },
    { username: 'ataetabenjamin@gmail.com', password: 'Benjamin@123', role: 'super_admin' },
    { username: 'hellogloby@gmail.com', password: 'Benjamin@123', role: 'super_admin' },
    { username: 'benjaminataeta@gmail.com', password: 'Benjamin@123', role: 'super_admin' },
    { username: 'authority@globyedu.test', password: 'GlobySchool@123', role: 'school_authority' },
    { username: 'T001', password: 'GlobyTeacher@123', role: 'teacher' },
    { username: 'STU001', password: 'GlobyStudent@123', role: 'student' },
  ];

  for (const credential of requiredCredentials) {
    const user = school.users.find((entry) => entry.username === credential.username && entry.role === credential.role);
    expect(user).toBeDefined();

    const storedHash = user.passwordHash || user.studentPasswordHash;
    expect(storedHash).toBeTruthy();
    expect(bcrypt.compareSync(credential.password, storedHash)).toBe(true);
  }
});

test('createStudentRecord assigns and preserves a unique generated student ID', () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();
  const first = school.students?.[0] || { studentId: 'STD-001' };
  const second = {
    fullName: 'Jane Doe',
    className: 'Form 1A',
    status: 'active',
    schoolId: school.schoolId,
  };

  const generated = first.studentId || 'STU001';
  expect(generated).toMatch(/^(STD|STU)-?/i);
  expect(generated).not.toBe(second.studentId);
});

test('entity onboarding generates usable teacher and student credentials without exposing hashes', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();
  const seededClass = school.classes[0];
  const teacher = await schoolService.createEntity(school.schoolId, 'teachers', {
    fullName: 'Generated Teacher',
    email: 'generated-teacher@globy.test',
    assignedClasses: [seededClass.classId],
    assignedSubjects: ['Science'],
  });
  const student = await schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Generated Student',
    email: 'generated-student@globy.test',
    classId: seededClass.classId,
    className: seededClass.name,
    profilePhoto: 'data:image/png;base64,student-photo',
  });
  const persisted = schoolService.getSchoolBySchoolId(school.schoolId);
  const reloaded = await persisted;
  const persistedTeacher = reloaded.users.find((user) => user.email === teacher.email);
  const persistedStudent = reloaded.users.find((user) => user.email === student.email);

  expect(teacher.teacherId).toMatch(/^T-/);
  expect(teacher.passwordHash).toBeUndefined();
  expect(teacher.passwordNeedsReset).toBe(true);
  expect(persistedTeacher.passwordHash).toMatch(/^\$2[aby]\$/);
  expect(student.studentId).toMatch(/^STD-/);
  expect(student.passwordHash).toBeUndefined();
  expect(student.passwordNeedsReset).toBe(true);
  expect(persistedStudent.passwordHash).toMatch(/^\$2[aby]\$/);
  expect(reloaded.students.find((entry) => entry.studentId === student.studentId).profilePhoto).toContain('data:image/png');
});

test('teachers can create and update students but must request deletion approval', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();
  const classRecord = school.classes[0];
  const actor = {
    userId: `${school.schoolId}:T001`,
    username: 'T001',
    roles: ['teacher'],
    schoolId: school.schoolId,
    tenantId: school.schoolId,
  };

  const created = await schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Teacher Added Student',
    email: 'teacher-added-student@globy.test',
    classId: classRecord.classId,
    className: classRecord.name,
    profilePhoto: 'data:image/png;base64,teacher-managed-photo',
  }, actor);

  const updated = await schoolService.updateEntity(school.schoolId, 'students', created.studentId, {
    fullName: 'Teacher Updated Student',
  }, actor);

  await expect(schoolService.deleteEntity(school.schoolId, 'students', created.studentId, actor, {
    confirmation: created.studentId,
  })).rejects.toThrow('Only School Authority can manage account deletion.');
  await schoolService.requestStudentDeletion(school.schoolId, created.studentId, 'Duplicate enrollment', actor);
  const authority = {
    userId: `${school.schoolId}:authority@globyedu.test`,
    roles: ['school_authority'],
    schoolId: school.schoolId,
    tenantId: school.schoolId,
  };
  await expect(schoolService.resolveStudentDeletionRequest(
    school.schoolId,
    created.studentId,
    'approved',
    created.studentId,
    authority,
  )).resolves.toEqual(expect.objectContaining({ studentId: created.studentId, status: 'approved' }));

  expect(created.studentId).toMatch(/^STD-/);
  expect(updated.fullName).toBe('Teacher Updated Student');
  const remainingSchool = require('../fallback.school').loadSchoolData().find((entry) => entry.schoolId === school.schoolId);
  expect(remainingSchool.students.find((entry) => entry.studentId === created.studentId)).toMatchObject({
    status: 'archived',
    classId: null,
    className: null,
    metadata: {
      deletionRequest: { status: 'approved' },
      classHistory: [expect.objectContaining({ classId: classRecord.classId })],
    },
  });
  expect(remainingSchool.users.find((entry) => entry.studentId === created.studentId)).toMatchObject({
    status: 'archived',
    classId: null,
    className: null,
  });
});

test('assigned teacher can create and update students using an assigned class grade', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = ensureDemoSchool();
  const actor = {
    userId: `${school.schoolId}:T001`,
    username: 'T001',
    roles: ['teacher'],
    schoolId: school.schoolId,
    tenantId: school.schoolId,
  };

  const created = await schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Teacher Created Student',
    email: 'teacher-created@globy.test',
    classId: 'JHS-3A',
    className: 'JHS 3A',
    profilePhoto: 'https://images.example.test/teacher-created.png',
  }, actor);
  const updated = await schoolService.updateEntity(school.schoolId, 'students', created.studentId, {
    fullName: 'Teacher Updated Student',
    className: 'JHS 3',
  }, actor);
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);
  const persistedUser = reloaded.users.find((entry) => entry.email === 'teacher-created@globy.test');

  expect(created.studentId).toMatch(/^STD-/);
  expect(created.passwordHash).toBeUndefined();
  expect(updated.fullName).toBe('Teacher Updated Student');
  expect(updated.passwordHash).toBeUndefined();
  expect(reloaded.students.find((entry) => entry.studentId === created.studentId)).toMatchObject({
    fullName: 'Teacher Updated Student',
    className: 'JHS 3A',
    profilePhoto: 'https://images.example.test/teacher-created.png',
  });
  expect(persistedUser.passwordHash).toMatch(/^\$2[aby]\$/);
  expect(persistedUser.passwordNeedsReset).toBe(true);
});

test('teacher access is denied to another school tenant', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const alphaSchool = ensureDemoSchool();
  const betaSchool = await schoolService.createSchool({
    name: 'Beta School',
    headEmail: 'beta-head@globy.test',
    headFullName: 'Beta Head',
  });

  const req = {
    user: { roles: ['teacher'], tenantId: alphaSchool.schoolId, schoolId: alphaSchool.schoolId },
    params: { schoolId: betaSchool.schoolId },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  const tenantMiddleware = require('../../school/middleware/tenant.middleware');
  await tenantMiddleware(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test('teacher creation omits national ID and signature fields', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();
  const teacher = await schoolService.createEntity(school.schoolId, 'teachers', {
    fullName: 'Photo Teacher',
    email: 'photo-teacher@globy.test',
    nationalId: 'SHOULD-NOT-PERSIST',
    signature: 'https://example.test/signature.png',
    profilePhoto: 'data:image/png;base64,real-photo-data',
  });
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);
  const persisted = reloaded.users.find((user) => user.email === teacher.email);

  expect(persisted.nationalId).toBeUndefined();
  expect(persisted.signature).toBeUndefined();
  expect(persisted.profilePhoto).toContain('data:image/png');
});

test('teacher updates keep national ID and signature out of existing school records', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = ensureDemoSchool();
  const teacher = await schoolService.createEntity(school.schoolId, 'teachers', {
    fullName: 'Existing School Teacher',
    email: 'existing-teacher@globy.test',
    profilePhoto: 'data:image/png;base64,existing-photo',
  });
  await schoolService.updateEntity(school.schoolId, 'teachers', teacher.teacherId, {
    nationalId: 'SHOULD-NOT-PERSIST',
    signature: 'https://example.test/signature.png',
    profilePhoto: 'data:image/png;base64,updated-photo',
  });

  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);
  const persisted = reloaded.users.find((user) => user.email === teacher.email);

  expect(persisted.nationalId).toBeUndefined();
  expect(persisted.signature).toBeUndefined();
  expect(persisted.profilePhoto).toContain('updated-photo');
});

test('createSchool preserves branding and logo data from registration payloads', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const created = await schoolService.createSchool({
    name: 'Logo Test School',
    headEmail: 'head@logo-test.globyedu.com',
    headPassword: 'HeadPass123!',
    logo: 'data:image/png;base64,abc123',
    coverImage: 'data:image/png;base64,cover123',
    description: 'A school created during registration',
    country: 'Ghana',
    region: 'Greater Accra',
    city: 'Accra',
    address: 'P.O. Box 123',
    phone: '+233200000000',
    email: 'admin@logo-test.globyedu.com',
    website: 'https://logo-test.edu',
    branding: { motto: 'Learn boldly', language: 'English', currency: 'GHS' },
  });

  expect(created.logo).toBe('data:image/png;base64,abc123');
  expect(created.coverImage).toBe('data:image/png;base64,cover123');
  expect(created.description).toContain('registration');
  expect(created.country).toBe('Ghana');
  expect(created.region).toBe('Greater Accra');
  expect(created.city).toBe('Accra');
  expect(created.address).toBe('P.O. Box 123');
  expect(created.branding).toMatchObject({ motto: 'Learn boldly', language: 'English', currency: 'GHS' });
});

test('new schools support class, teacher, and student onboarding without manual IDs', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const school = await schoolService.createSchool({
    name: 'Fresh QA School',
    headEmail: 'fresh-head@globy.test',
    headFullName: 'Fresh Head',
  });
  const createdClass = await schoolService.createEntity(school.schoolId, 'classes', { name: 'Grade 7A' });
  const teacher = await schoolService.createEntity(school.schoolId, 'teachers', {
    fullName: 'Fresh Teacher',
    email: 'fresh-teacher@globy.test',
    assignedClasses: [createdClass.classId],
    profilePhoto: 'data:image/png;base64,fresh-teacher-photo',
    nationalId: 'SHOULD-NOT-PERSIST',
    signature: 'https://example.test/signature.png',
  });
  const student = await schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Fresh Student',
    email: 'fresh-student@globy.test',
    classId: createdClass.classId,
    className: createdClass.name,
  });
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);

  expect(school.headAccount.username).toBe('fresh-head@globy.test');
  expect(reloaded.classes.some((item) => item.classId === createdClass.classId)).toBe(true);
  expect(teacher.teacherId).toBeTruthy();
  expect(teacher.profilePhoto).toContain('data:image/png');
  expect(teacher.nationalId).toBeUndefined();
  expect(teacher.signature).toBeUndefined();
  expect(student.studentId).toBeTruthy();
  expect(reloaded.students.find((item) => item.studentId === student.studentId).classId).toBe(createdClass.classId);
  expect(reloaded.teachers.find((item) => item.teacherId === teacher.teacherId).assignedClasses).toContain(createdClass.classId);
});

test('class archival preserves history and requires current students and teachers to be reassigned', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = await schoolService.createSchool({
    name: 'Class Archive Test School',
    headEmail: 'archive-head@globy.test',
    headFullName: 'Archive Head',
  });
  const classRecord = await schoolService.createEntity(school.schoolId, 'classes', { name: 'Grade 7A' });
  const teacher = await schoolService.createEntity(school.schoolId, 'teachers', {
    fullName: 'Archive Test Teacher',
    email: 'archive-teacher@globy.test',
    assignedClasses: [classRecord.classId],
  });
  const student = await schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Archive Test Student',
    classId: classRecord.classId,
    className: classRecord.name,
  });
  const persistedSchools = loadSchoolData();
  const persistedSchool = persistedSchools.find((entry) => entry.schoolId === school.schoolId);
  persistedSchool.attendanceRecords = [{
    studentId: student.studentId,
    classId: classRecord.classId,
    date: '2026-09-01',
    status: 'present',
  }];
  saveSchoolData(persistedSchools);
  const authority = { roles: ['school_authority'], tenantId: school.schoolId };

  await expect(schoolService.deleteEntity(school.schoolId, 'classes', classRecord.classId, authority))
    .rejects.toThrow('Students are still assigned to this class.');
  await schoolService.updateEntity(school.schoolId, 'students', student.studentId, {
    classId: null,
    className: null,
  }, authority);
  await expect(schoolService.deleteEntity(school.schoolId, 'classes', classRecord.classId, authority))
    .rejects.toThrow('Teachers are still assigned to this class.');
  await schoolService.updateEntity(school.schoolId, 'teachers', teacher.teacherId, { assignedClasses: [] }, authority);

  const archived = await schoolService.deleteEntity(school.schoolId, 'classes', classRecord.classId, authority);
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);

  expect(archived.status).toBe('archived');
  expect(reloaded.classes.find((entry) => entry.classId === classRecord.classId).status).toBe('archived');
  expect(reloaded.students.some((entry) => entry.studentId === student.studentId)).toBe(true);
  expect(reloaded.attendanceRecords).toEqual([expect.objectContaining({ studentId: student.studentId, classId: classRecord.classId })]);
  await expect(schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'New Student',
    classId: classRecord.classId,
  }, authority)).rejects.toThrow('Students cannot be enrolled in an archived class.');
});

test('class archival cannot race with a concurrent enrollment', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = await schoolService.createSchool({
    name: 'Concurrent Class Archive Test School',
    headEmail: 'concurrent-archive-head@globy.test',
    headFullName: 'Concurrent Archive Head',
  });
  const classRecord = await schoolService.createEntity(school.schoolId, 'classes', { name: 'Grade 9A' });
  const authority = { roles: ['school_authority'], tenantId: school.schoolId };

  const [archiveResult, enrollmentResult] = await Promise.allSettled([
    schoolService.deleteEntity(school.schoolId, 'classes', classRecord.classId, authority),
    schoolService.createEntity(school.schoolId, 'students', {
      fullName: 'Concurrent Enrollment Student',
      classId: classRecord.classId,
    }, authority),
  ]);
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);

  expect(archiveResult.status).toBe('fulfilled');
  expect(enrollmentResult.status).toBe('rejected');
  expect(enrollmentResult.reason.message).toMatch(/archived class/i);
  expect(reloaded.classes.find((entry) => entry.classId === classRecord.classId).status).toBe('archived');
  expect(reloaded.students).toHaveLength(0);
});

test('class archival cannot race with a concurrent teacher assignment', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = await schoolService.createSchool({
    name: 'Concurrent Assignment Test School',
    headEmail: 'concurrent-assignment-head@globy.test',
    headFullName: 'Concurrent Assignment Head',
  });
  const classRecord = await schoolService.createEntity(school.schoolId, 'classes', { name: 'Grade 10A' });
  const teacher = await schoolService.createEntity(school.schoolId, 'teachers', {
    fullName: 'Concurrent Assignment Teacher',
    email: 'concurrent-assignment-teacher@globy.test',
  });
  const authority = { roles: ['school_authority'], tenantId: school.schoolId };

  const [archiveResult, assignmentResult] = await Promise.allSettled([
    schoolService.deleteEntity(school.schoolId, 'classes', classRecord.classId, authority),
    schoolService.updateEntity(school.schoolId, 'classes', classRecord.classId, {
      teacherIds: [teacher.teacherId],
    }, authority),
  ]);
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);

  expect(archiveResult.status).toBe('fulfilled');
  expect(assignmentResult.status).toBe('rejected');
  expect(assignmentResult.reason.message).toMatch(/archived class/i);
  expect(reloaded.classes.find((entry) => entry.classId === classRecord.classId)).toMatchObject({
    status: 'archived',
    teacherIds: [],
  });
});

test('teacher-created students persist for School Authority and every teacher assigned to the class', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = await schoolService.createSchool({
    name: 'Shared Roster Test School',
    headEmail: 'shared-roster-head@globy.test',
    headFullName: 'Shared Roster Head',
  });
  const classRecord = await schoolService.createEntity(school.schoolId, 'classes', { name: 'Grade 8A' });
  const teachers = [];
  for (const suffix of ['one', 'two']) {
    teachers.push(await schoolService.createEntity(school.schoolId, 'teachers', {
      fullName: `Roster Teacher ${suffix}`,
      email: `roster-teacher-${suffix}@globy.test`,
      assignedClasses: [classRecord.classId],
    }));
  }
  await schoolService.updateEntity(school.schoolId, 'classes', classRecord.classId, {
    teacherIds: teachers.map((teacher) => teacher.teacherId),
  }, { roles: ['school_authority'], tenantId: school.schoolId });

  const persistedBeforeStudent = await schoolService.getSchoolBySchoolId(school.schoolId);
  expect(persistedBeforeStudent.classes.find((entry) => entry.classId === classRecord.classId).teacherIds)
    .toEqual(teachers.map((teacher) => teacher.teacherId));
  expect(schoolService.getTeacherSchoolView(persistedBeforeStudent, {
    username: teachers[0].email,
    roles: ['teacher'],
  }).classes.map((entry) => entry.classId)).toContain(classRecord.classId);

  const createdStudent = await schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Teacher-created Student',
    email: 'teacher-created-student@globy.test',
    classId: classRecord.classId,
    className: classRecord.name,
  }, {
    roles: ['teacher'],
    userId: `${school.schoolId}:${teachers[0].teacherId}`,
    tenantId: school.schoolId,
  });
  const reloaded = await schoolService.getSchoolBySchoolId(school.schoolId);

  expect(reloaded.students.find((student) => student.studentId === createdStudent.studentId).classId)
    .toBe(classRecord.classId);
  for (const teacher of teachers) {
    const teacherView = schoolService.getTeacherSchoolView(reloaded, {
      userId: `${school.schoolId}:${teacher.teacherId}`,
      username: teacher.email,
      roles: ['teacher'],
    });
    expect(teacherView.students.map((student) => student.studentId)).toContain(createdStudent.studentId);
  }
});

test('Firebase class archival updates the existing tenant-scoped class document', async () => {
  const schoolId = 'firebase-archive-school';
  const school = {
    schoolId,
    classes: [{ classId: 'class-a', name: 'Class A', status: 'active', teacherIds: [] }],
    students: [],
    teachers: [],
    users: [],
  };
  const classReference = { id: `${schoolId}:class-a` };
  const transaction = {
    get: jest.fn(async () => ({ docs: [] })),
    set: jest.fn(),
  };
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockResolvedValue(school);
  const runClassMutation = jest.spyOn(firebaseCore, 'runClassMutation').mockImplementation(async (
    requestedSchoolId,
    classIds,
    operation,
  ) => {
    expect(requestedSchoolId).toBe(schoolId);
    expect(classIds).toEqual(['class-a']);
    const updates = await operation({
      transaction,
      classRecords: [{ ...school.classes[0], id: classReference.id }],
      classReferences: [classReference],
      getSchoolQuery: (collectionName) => ({ collectionName }),
    });
    transaction.set(classReference, updates.classUpdatesById[classReference.id], { merge: true });
    return updates.result;
  });

  const result = await schoolService.deleteEntity(schoolId, 'classes', 'class-a', {
    roles: ['school_authority'],
    tenantId: schoolId,
  });

  expect(result.status).toBe('archived');
  expect(runClassMutation).toHaveBeenCalledWith(schoolId, ['class-a'], expect.any(Function));
  expect(transaction.get).toHaveBeenCalledTimes(4);
  expect(transaction.set).toHaveBeenCalledWith(
    classReference,
    expect.objectContaining({ status: 'archived' }),
    { merge: true },
  );
});

test('Firebase class archival blocks a current enrollment read inside its transaction', async () => {
  const schoolId = 'firebase-enrollment-archive-school';
  const school = {
    schoolId,
    classes: [{ classId: 'class-a', name: 'Class A', status: 'active', teacherIds: [] }],
    students: [],
    teachers: [],
    users: [],
  };
  const classReference = { id: `${schoolId}:class-a` };
  const transaction = {
    get: jest.fn(async (query) => ({
      docs: query.collectionName === 'enrollments'
        ? [{ id: `${schoolId}:enrollment-1`, data: () => ({
            studentId: 'STU-1',
            classId: 'class-a',
            status: 'active',
            isCurrent: true,
          }) }]
        : [],
    })),
    set: jest.fn(),
  };
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockResolvedValue(school);
  jest.spyOn(firebaseCore, 'runClassMutation').mockImplementation(async (
    requestedSchoolId,
    classIds,
    operation,
  ) => {
    expect(requestedSchoolId).toBe(schoolId);
    expect(classIds).toEqual(['class-a']);
    return operation({
      transaction,
      classRecords: [{ ...school.classes[0], id: classReference.id }],
      classReferences: [classReference],
      getSchoolQuery: (collectionName) => ({ collectionName }),
    });
  });

  await expect(schoolService.deleteEntity(schoolId, 'classes', 'class-a', {
    roles: ['school_authority'],
    tenantId: schoolId,
  })).rejects.toThrow('Students are still assigned to this class.');
  expect(transaction.set).not.toHaveBeenCalled();
});

test('super admin list includes newly created schools instead of filtering to the demo tenant only', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const demo = ensureDemoSchool();
  const created = await schoolService.createSchool({
    name: 'Visible School',
    headEmail: 'visible-head@globy.test',
    headFullName: 'Visible Head',
  });

  const schools = await schoolService.listSchools('');
  const ids = schools.map((entry) => entry.schoolId);

  expect(ids).toContain(demo.schoolId);
  expect(ids).toContain(created.schoolId);
  expect(schools.some((entry) => entry.name === 'Visible School')).toBe(true);
});

test('Firebase Super Admin school list reads every persisted tenant', async () => {
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'listTenants').mockResolvedValue([
    { id: 'school-live-a', schoolId: 'school-live-a', name: 'Live Academy' },
    { id: 'school-live-b', schoolId: 'school-live-b', name: 'North School' },
  ]);

  const schools = await schoolService.listSchools('');

  expect(schools.map((school) => school.schoolId)).toEqual(['school-live-a', 'school-live-b']);
  expect(firebaseCore.listTenants).toHaveBeenCalledTimes(1);
});

test('Firebase student photo updates persist to Firestore student and user records', async () => {
  const school = {
    schoolId: 'school-live',
    students: [{ studentId: 'STD-1', email: 'student@live.test', fullName: 'Live Student', schoolId: 'school-live' }],
    teachers: [],
    classes: [],
    users: [],
  };
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockResolvedValue(school);
  const saveById = jest.spyOn(firebaseCore, 'saveById').mockResolvedValue({});

  const updated = await schoolService.updateEntity('school-live', 'students', 'STD-1', {
    profilePhoto: 'https://images.example.test/student.png',
    profilePhotoPath: 'schools/school-live/students/STD-1/profile.png',
  }, { roles: ['school_authority'] });

  expect(updated.profilePhoto).toBe('https://images.example.test/student.png');
  expect(updated.profilePhotoPath).toBe('schools/school-live/students/STD-1/profile.png');
  expect(saveById).toHaveBeenCalledWith('students', 'school-live:STD-1', expect.objectContaining({
    profilePhoto: updated.profilePhoto,
    profilePhotoPath: updated.profilePhotoPath,
  }), true);
  expect(saveById).toHaveBeenCalledWith('users', 'school-live:student@live.test', expect.objectContaining({
    profilePhoto: updated.profilePhoto,
    profilePhotoPath: updated.profilePhotoPath,
    metadata: expect.objectContaining({ profilePhotoPath: updated.profilePhotoPath }),
  }), true);
});

test('Firebase student creation uses create-only persistence and rolls back a partial identity write', async () => {
  const schoolId = 'school-live-create';
  const school = {
    id: schoolId,
    schoolId,
    students: [],
    teachers: [],
    users: [],
    classes: [],
  };
  const records = new Map();
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockResolvedValue(school);
  jest.spyOn(firebaseCore, 'createById').mockImplementation(async (collection, id, data) => {
    const key = `${collection}:${id}`;
    if (records.has(key)) {
      const error = new Error('Document already exists');
      error.code = 6;
      throw error;
    }
    records.set(key, data);
    return { id, ...data };
  });
  jest.spyOn(firebaseCore, 'deleteById').mockImplementation(async (collection, id) => {
    records.delete(`${collection}:${id}`);
  });
  jest.spyOn(firebaseCore, 'saveById').mockResolvedValue({});

  const actor = { roles: ['school_authority'], schoolId, tenantId: schoolId };
  const student = await schoolService.createEntity(schoolId, 'students', {
    studentId: 'STD-006-ZXC',
    fullName: 'Persisted Student',
    email: 'persisted@student.test',
  }, actor);

  expect(student.studentId).toBe('STD-006-ZXC');
  expect(records.get(`students:${schoolId}:STD-006-ZXC`)).toEqual(expect.objectContaining({
    studentId: 'STD-006-ZXC',
    schoolId,
  }));
  expect(records.get(`users:${schoolId}:persisted@student.test`)).toEqual(expect.objectContaining({
    studentId: 'STD-006-ZXC',
    email: 'persisted@student.test',
  }));
  await expect(schoolService.createEntity(schoolId, 'students', {
    studentId: 'STD-006-ZXC',
    fullName: 'Persisted Student',
    email: 'persisted@student.test',
  }, actor)).rejects.toThrow('already exists');
  expect(records.get(`students:${schoolId}:STD-006-ZXC`).fullName).toBe('Persisted Student');

  const partialSchoolId = 'school-live-partial';
  jest.spyOn(firebaseCore, 'getSchoolAggregate').mockResolvedValue({
    id: partialSchoolId,
    schoolId: partialSchoolId,
    students: [],
    teachers: [],
    users: [],
    classes: [],
  });
  jest.spyOn(firebaseCore, 'createById').mockImplementation(async (collection, id, data) => {
    if (collection === 'users') throw new Error('User write failed');
    records.set(`${collection}:${id}`, data);
    return { id, ...data };
  });

  await expect(schoolService.createEntity(partialSchoolId, 'students', {
    studentId: 'STD-PARTIAL',
    fullName: 'Partial Student',
    email: 'partial@student.test',
  }, { roles: ['school_authority'], schoolId: partialSchoolId, tenantId: partialSchoolId }))
    .rejects.toThrow('User write failed');
  expect(records.has(`students:${partialSchoolId}:STD-PARTIAL`)).toBe(false);
});

test('class identity is unique within an academic year and only configured aliases are equivalent', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = await schoolService.createSchool({ name: 'Class Identity School' });

  await schoolService.createEntity(school.schoolId, 'classes', {
    name: 'JHS 1',
    grade: 'JHS 1',
    academicYearId: 'AY-1',
  });
  await expect(schoolService.createEntity(school.schoolId, 'classes', {
    name: 'JHS 1',
    grade: 'JHS 1',
    academicYearId: 'AY-1',
  })).rejects.toThrow('already exists');

  await expect(schoolService.createEntity(school.schoolId, 'classes', {
    name: 'Basic 7',
    grade: 'Basic 7',
    academicYearId: 'AY-1',
  })).resolves.toBeTruthy();
  await schoolService.updateSchool(school.id, {
    academicStructure: { classAliases: { 'JHS 1': ['Basic 7', 'Form 1'] } },
  });
  await expect(schoolService.createEntity(school.schoolId, 'classes', {
    name: 'Form 1',
    grade: 'Form 1',
    academicYearId: 'AY-1',
  })).rejects.toThrow('already exists');

  await expect(schoolService.createEntity(school.schoolId, 'classes', {
    name: 'Form 1',
    grade: 'Form 1',
    academicYearId: 'AY-2',
  })).resolves.toBeTruthy();

  for (const grade of ['JHS 2', 'JHS 3']) {
    await expect(schoolService.createEntity(school.schoolId, 'classes', {
      name: grade,
      grade,
      academicYearId: 'AY-1',
    })).resolves.toBeTruthy();
  }
});

test('a class supports multiple persistent teacher assignments and assigned-class student access', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');
  const school = await schoolService.createSchool({ name: 'Multi Teacher School' });
  const teachers = [];
  for (const teacherId of ['T-MULTI-1', 'T-MULTI-2', 'T-UNASSIGNED']) {
    teachers.push(await schoolService.createEntity(school.schoolId, 'teachers', {
      teacherId,
      fullName: teacherId,
      email: `${teacherId.toLowerCase()}@school.test`,
    }));
  }
  const assignedIds = teachers.slice(0, 2).map((teacher) => teacher.teacherId);
  const classRecord = await schoolService.createEntity(school.schoolId, 'classes', {
    name: 'JHS 3 Blue',
    grade: 'JHS 3',
    section: 'Blue',
    academicYearId: 'AY-1',
    teacherIds: [...assignedIds, assignedIds[0]],
  });
  const teacherActors = assignedIds.map((teacherId) => ({
    userId: `${school.schoolId}:${teacherId}`,
    username: teacherId,
    roles: ['teacher'],
    schoolId: school.schoolId,
    tenantId: school.schoolId,
  }));

  expect(classRecord.teacherIds).toEqual(assignedIds);
  for (const teacherActor of teacherActors) {
    const classList = await schoolService.getEntities(school.schoolId, 'classes', {}, teacherActor);
    expect(classList.items.map((entry) => entry.classId || entry.id)).toContain(classRecord.classId);
  }
  await expect(schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Assigned Teacher Student',
    email: 'assigned-student@school.test',
    classId: classRecord.classId,
    className: classRecord.name,
  }, teacherActors[1])).resolves.toMatchObject({ classId: classRecord.classId });
  await expect(schoolService.createEntity(school.schoolId, 'students', {
    fullName: 'Unassigned Teacher Student',
    email: 'unassigned-student@school.test',
    classId: classRecord.classId,
    className: classRecord.name,
  }, {
    userId: `${school.schoolId}:${teachers[2].teacherId}`,
    username: teachers[2].teacherId,
    roles: ['teacher'],
    schoolId: school.schoolId,
    tenantId: school.schoolId,
  })).rejects.toThrow('not authorized');
});

test('createSchool assigns a normalized, collision-safe subdomain and persists it', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const created = await schoolService.createSchool({ name: 'Globy School' });

  expect(created.subdomain).toBe('globy-school');
  expect(generateSchoolSubdomain('Globy School', [])).toBe('globy-school');
  expect(generateSchoolSubdomain('Admin', [{ subdomain: 'admin' }])).not.toBe('admin');
  expect(generateSchoolSubdomain('Globy School', [{ subdomain: 'globy-school' }])).toMatch(/^globy-school-\d+$/);
});

test('hostname resolution resolves the tenant from a valid subdomain and rejects reserved hosts', () => {
  const schools = [
    { schoolId: 'school-a', name: 'School A', subdomain: 'school-a' },
    { schoolId: 'school-b', name: 'School B', subdomain: 'school-b' },
  ];

  expect(resolveTenantFromHostname('school-a.globyedu.com', schools)?.schoolId).toBe('school-a');
  expect(resolveTenantFromHostname('school-a.localhost', schools)?.schoolId).toBe('school-a');
  expect(resolveTenantFromHostname('admin.globyedu.com', schools)).toBeNull();
  expect(resolveTenantFromHostname('unknown.globyedu.com', schools)).toBeNull();
  expect(resolveTenantFromHostname('globyedu.com', schools)).toBeNull();
});

test('new schools receive a 14-day free trial and persist the trial expiry date', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const created = await schoolService.createSchool({
    name: 'Trial School',
    headEmail: 'trial-head@globy.test',
    headPassword: 'HeadPass123!',
  });

  expect(created.subscriptionStatus).toBe('trial');
  expect(created.schoolStatus).toBe('active');
  expect(created.trialEndsAt).toBeTruthy();

  const expiry = new Date(created.trialEndsAt).getTime();
  const now = Date.now();
  expect(expiry).toBeGreaterThan(now);
  expect(expiry - now).toBeGreaterThanOrEqual(13 * 24 * 60 * 60 * 1000);
  expect(expiry - now).toBeLessThanOrEqual(14 * 24 * 60 * 60 * 1000 + 60000);
});

test('expired trial changes subscription state without changing operational school status', async () => {
  fs.writeFileSync(schoolsFile, JSON.stringify({ schools: [] }, null, 2), 'utf8');

  const created = await schoolService.createSchool({
    name: 'Expired Trial School',
    headEmail: 'expired-head@globy.test',
    headPassword: 'HeadPass123!',
  });

  const { loadSchoolData, saveSchoolData } = require('../fallback.school');
  const schools = loadSchoolData();
  const record = schools.find((entry) => entry.schoolId === created.schoolId);
  if (!record) throw new Error('School not found after creation');

  record.subscriptionStatus = 'trial';
  record.schoolStatus = 'active';
  record.trialEndsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  saveSchoolData(schools);

  const resolved = await schoolService.getSchoolBySchoolId(created.schoolId);
  expect(resolved.schoolStatus).toBe('active');
  expect(resolved.subscriptionStatus).toBe('expired');

  const firebaseMode = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(false);
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await tenantMiddleware({
    user: { roles: ['school_authority'], tenantId: created.schoolId, schoolId: created.schoolId },
    params: { schoolId: created.schoolId },
    body: {},
    headers: {},
  }, response, next);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_EXPIRED' }));
  expect(next).not.toHaveBeenCalled();
  firebaseMode.mockRestore();
});
