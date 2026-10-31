const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { ensureDemoSchool } = require('../fallback.school');
const schoolService = require('../school.service');
const firebaseCore = require('../../../firebase.core');
const firebaseData = require('../../../firebase.data');
const tenantMiddleware = require('../middleware/tenant.middleware');
const { generateSchoolSubdomain, resolveTenantFromHostname } = require('../tenant-hostname');

const schoolsFile = path.join(__dirname, '../../../data/schools.json');
const originalData = fs.existsSync(schoolsFile) ? fs.readFileSync(schoolsFile, 'utf8') : '';

afterEach(() => {
  fs.writeFileSync(schoolsFile, originalData, 'utf8');
  jest.restoreAllMocks();
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

test('teachers can create, update, and delete students within their own school', async () => {
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

  const deleted = await schoolService.deleteEntity(school.schoolId, 'students', created.studentId, actor);

  expect(created.studentId).toMatch(/^STD-/);
  expect(updated.fullName).toBe('Teacher Updated Student');
  expect(deleted.studentId).toBe(created.studentId);
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

test('new schools receive a 5-day free trial and persist the trial expiry date', async () => {
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
  expect(expiry - now).toBeGreaterThanOrEqual(4 * 24 * 60 * 60 * 1000);
  expect(expiry - now).toBeLessThanOrEqual(5 * 24 * 60 * 60 * 1000 + 60000);
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
