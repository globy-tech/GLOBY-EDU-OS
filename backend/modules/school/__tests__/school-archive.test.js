const schoolService = require('../school.service');
const tenantMiddleware = require('../middleware/tenant.middleware');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');
const prisma = require('../../../config/prisma.client');

const SCHOOL_ID = 'archive-qa-school-001';

function createSchool() {
  return {
    id: 'archive-qa-tenant-id',
    schoolId: SCHOOL_ID,
    name: 'Archive QA School',
    schoolStatus: 'active',
    status: 'active',
    subscriptionStatus: 'trial',
    users: [{ id: 'user-1', email: 'head@example.test', role: 'school_authority' }],
    classes: [{ id: 'class-1', name: 'Class 1' }],
    payments: [{ id: 'payment-1', amount: 100 }],
    subscriptions: [{ id: 'subscription-1', plan: 'trial' }],
  };
}

async function withMockPrismaDeletion({ dependencyModel = null, deleteError = null } = {}, run) {
  const countModels = ['user', 'department', 'stream', 'subject', 'academicYear', 'term', 'semester', 'class', 'enrollment'];
  const originalStub = prisma.__stub;
  const originalTenant = prisma.tenant;
  const originalModels = Object.fromEntries(countModels.map((model) => [model, prisma[model]]));
  const tenant = {
    id: 'prisma-archive-tenant-id',
    schoolId: SCHOOL_ID,
    name: 'Prisma Archive Fixture',
    archivedAt: new Date('2026-10-02T00:00:00.000Z'),
    users: [],
    departments: [],
    streams: [],
    subjects: [],
    academicYears: [],
    terms: [],
    semesters: [],
    classes: [],
  };
  const countMocks = {};
  countModels.forEach((model) => {
    countMocks[model] = jest.fn().mockResolvedValue(model === dependencyModel ? 1 : 0);
    prisma[model] = { ...(prisma[model] || {}), count: countMocks[model] };
  });
  const deleteTenant = jest.fn().mockImplementation(() => (
    deleteError ? Promise.reject(deleteError) : Promise.resolve(tenant)
  ));
  prisma.tenant = {
    ...originalTenant,
    findUnique: jest.fn().mockResolvedValue(tenant),
    delete: deleteTenant,
  };
  jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);
  prisma.__stub = false;

  try {
    return await run({ countMocks, deleteTenant });
  } finally {
    prisma.__stub = originalStub;
    prisma.tenant = originalTenant;
    countModels.forEach((model) => {
      if (originalModels[model] === undefined) delete prisma[model];
      else prisma[model] = originalModels[model];
    });
  }
}

describe('Super Admin school archive service', () => {
  let previousSnapshot;
  let hadPreviousSnapshot;

  beforeEach(() => {
    hadPreviousSnapshot = Object.prototype.hasOwnProperty.call(global, '__workspaceSnapshot');
    previousSnapshot = global.__workspaceSnapshot;
    global.__workspaceSnapshot = [createSchool()];
  });

  afterEach(() => {
    if (hadPreviousSnapshot) global.__workspaceSnapshot = previousSnapshot;
    else delete global.__workspaceSnapshot;
    jest.restoreAllMocks();
  });

  it('archives without changing school status or removing tenant data', async () => {
    const original = createSchool();
    const archived = await schoolService.archiveSchool(SCHOOL_ID);

    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(archived.schoolStatus).toBe(original.schoolStatus);
    expect(archived.status).toBe(original.status);
    expect(archived.subscriptionStatus).toBe(original.subscriptionStatus);
    expect(archived.users).toEqual(original.users);
    expect(archived.classes).toEqual(original.classes);
    expect(archived.payments).toEqual(original.payments);
    expect(archived.subscriptions).toEqual(original.subscriptions);
  });

  it('keeps archived schools out of the normal list and returns them in the archived list', async () => {
    await schoolService.archiveSchool(SCHOOL_ID);

    expect(await schoolService.listSchools()).toEqual([]);
    expect((await schoolService.listArchivedSchools()).map((school) => school.schoolId)).toEqual([SCHOOL_ID]);
    expect((await schoolService.listArchivedSchools('archive qa')).map((school) => school.schoolId)).toEqual([SCHOOL_ID]);
    expect(await schoolService.listArchivedSchools('not a match')).toEqual([]);
    expect((await schoolService.listArchivedSchools('', 'trial')).map((school) => school.schoolId)).toEqual([SCHOOL_ID]);
    expect((await schoolService.listArchivedSchools('', 'active')).map((school) => school.schoolId)).toEqual([SCHOOL_ID]);
    expect(await schoolService.listArchivedSchools('', 'suspended')).toEqual([]);
  });

  it('excludes archived schools from platform summary metrics', async () => {
    await schoolService.archiveSchool(SCHOOL_ID);

    const summary = await schoolService.getPlatformSummary();

    expect(summary.totalSchools).toBe(0);
    expect(summary.schools).toEqual([]);
  });

  it('reports operational school state separately from subscription state', async () => {
    const summary = await schoolService.getPlatformSummary();

    expect(summary.activeSchools).toBe(1);
    expect(summary.trialSchools).toBe(1);
    expect(summary.activeSubscriptions).toBe(0);
    expect(summary.suspendedSchools).toBe(0);
  });

  it('counts school-scoped profiles without double-counting role users or archived records', async () => {
    global.__workspaceSnapshot = [
      {
        ...createSchool(),
        id: 'metrics-school-a',
        schoolId: 'metrics-school-a',
        users: [
          { role: 'school_authority', status: 'active' },
          { roles: ['student'], status: 'active' },
          { roles: [{ role: { name: 'teacher' } }], status: 'active' },
        ],
        teachers: [],
        students: [],
      },
      {
        ...createSchool(),
        id: 'metrics-school-b',
        schoolId: 'metrics-school-b',
        users: [
          { role: 'teacher', status: 'active' },
          { role: 'student', status: 'active' },
        ],
        teachers: [{ status: 'active' }, { status: 'archived' }],
        students: [{ status: 'active' }, { status: 'archived' }],
      },
    ];

    const summary = await schoolService.getPlatformSummary();

    expect(summary.totalStudents).toBe(2);
    expect(summary.totalTeachers).toBe(2);
    expect(summary.schools.map(({ schoolId, studentCount, teacherCount }) => ({ schoolId, studentCount, teacherCount }))).toEqual([
      { schoolId: 'metrics-school-a', studentCount: 1, teacherCount: 1 },
      { schoolId: 'metrics-school-b', studentCount: 1, teacherCount: 1 },
    ]);
  });

  it('includes Prisma user-role relations when building platform student and teacher metrics', async () => {
    const originalStub = prisma.__stub;
    const findMany = jest.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{
      id: 'metrics-prisma-tenant',
      schoolId: 'metrics-prisma-school',
      name: 'Prisma Metrics School',
      status: 'active',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
      users: [
        { status: 'active', roles: [{ role: { name: 'teacher' } }] },
        { status: 'active', roles: [{ role: { name: 'student' } }] },
      ],
    }]);
    jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);
    prisma.__stub = false;

    try {
      const summary = await schoolService.getPlatformSummary();

      expect(findMany).toHaveBeenCalledWith({
        include: { users: { include: { roles: { include: { role: true } } } } },
      });
      expect(summary).toMatchObject({
        totalStudents: 1,
        totalTeachers: 1,
        schools: [{ schoolId: 'metrics-prisma-school', studentCount: 1, teacherCount: 1 }],
      });
    } finally {
      prisma.__stub = originalStub;
    }
  });

  it('returns only the authenticated student report card while preserving other dashboard data', () => {
    const school = {
      ...createSchool(),
      students: [
        { studentId: 'STU-A', fullName: 'Student Alpha', classId: 'class-a', className: 'Class A' },
        { studentId: 'STU-B', fullName: 'Student Beta', classId: 'class-b', className: 'Class B' },
      ],
      reportCards: [
        { id: 'report-a', student: 'Student Alpha', term: 'Term 1', academicYear: '2026/2027', grade: 'A', status: 'Ready' },
        { id: 'report-b', student: 'Student Beta', term: 'Term 1', academicYear: '2026/2027', grade: 'C', status: 'Ready' },
      ],
      attendanceRecords: [
        { studentId: 'STU-A', date: '2026-10-01', status: 'present' },
        { studentId: 'STU-B', date: '2026-10-01', status: 'absent' },
      ],
      examResults: [
        { studentId: 'STU-A', subject: 'Math', mark: 95 },
        { studentId: 'STU-B', subject: 'Math', mark: 60 },
      ],
    };

    const studentView = schoolService.getStudentSchoolView(school, {
      userId: `${SCHOOL_ID}:STU-A`,
      roles: ['student'],
    });

    expect(studentView.reportCards).toEqual([school.reportCards[0]]);
    expect(studentView.schoolId).toBe(SCHOOL_ID);
    expect(studentView.student.studentId).toBe('STU-A');
    expect(studentView.attendanceRecords).toEqual([school.attendanceRecords[0]]);
    expect(studentView.examResults).toEqual([school.examResults[0]]);
  });

  it('removes signed file URLs from school and profile responses while preserving paths and public URLs', () => {
    const signedR2Url = 'https://files.example.test/private.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=not-a-real-signature';
    const signedFirebaseUrl = 'https://firebasestorage.googleapis.com/v0/b/example/o/photo.png?alt=media&token=not-a-real-token';
    const school = {
      ...createSchool(),
      logo: signedR2Url,
      logoPath: 'school-logo/logo.png',
      stamp: signedR2Url,
      stampPath: 'school-assets/stamp.png',
      branding: { logo: signedR2Url, motto: 'Learn together' },
      teachers: [{
        teacherId: 'T-A',
        username: 'T-A',
        assignedClasses: ['class-a'],
        profilePhoto: signedR2Url,
        profilePhotoPath: 'teacher-profile/teacher.png',
      }],
      students: [{
        studentId: 'STU-A',
        classId: 'class-a',
        className: 'Class A',
        profilePhoto: signedFirebaseUrl,
        profilePhotoPath: 'student-profile/student.png',
      }],
      classes: [{ classId: 'class-a', name: 'Class A', teacherId: 'T-A' }],
    };

    const sanitized = schoolService.sanitizeSchoolResponse(school);
    const teacherView = schoolService.getTeacherSchoolView(school, {
      userId: `${SCHOOL_ID}:T-A`,
      roles: ['teacher'],
    });
    const studentView = schoolService.getStudentSchoolView(school, {
      userId: `${SCHOOL_ID}:STU-A`,
      roles: ['student'],
    });

    expect(sanitized.logo).toBeNull();
    expect(sanitized.logoPath).toBe('school-logo/logo.png');
    expect(sanitized.stamp).toBeNull();
    expect(sanitized.branding.logo).toBeNull();
    expect(sanitized.teachers[0].profilePhoto).toBeNull();
    expect(sanitized.students[0].profilePhoto).toBeNull();
    expect(teacherView.logo).toBeNull();
    expect(teacherView.students[0].profilePhoto).toBeNull();
    expect(studentView.student.profilePhoto).toBeNull();
    expect(studentView.student.profilePhotoPath).toBe('student-profile/student.png');

    const publicPhoto = schoolService.sanitizeSchoolResponse({
      students: [{ studentId: 'STU-PUBLIC', profilePhoto: 'https://cdn.example.test/public-photo.png' }],
    });
    expect(publicPhoto.students[0].profilePhoto).toBe('https://cdn.example.test/public-photo.png');
  });

  it('limits teacher report cards to authorized students and fails closed for ambiguous legacy names', () => {
    const school = {
      ...createSchool(),
      teachers: [{ teacherId: 'T-A', username: 'T-A', assignedClasses: ['class-a'] }],
      classes: [
        { classId: 'class-a', name: 'Class A', teacherId: 'T-A' },
        { classId: 'class-b', name: 'Class B', teacherId: 'T-B' },
      ],
      students: [
        { studentId: 'STU-A', fullName: 'Student Alpha', classId: 'class-a', className: 'Class A' },
        { studentId: 'STU-B', fullName: 'Student Beta', classId: 'class-b', className: 'Class B' },
        { studentId: 'STU-C', fullName: 'Shared Name', classId: 'class-a', className: 'Class A' },
        { studentId: 'STU-D', fullName: 'Shared Name', classId: 'class-b', className: 'Class B' },
      ],
      reportCards: [
        { id: 'report-a', student: 'Student Alpha', term: 'Term 1', grade: 'A' },
        { id: 'report-b', student: 'Student Beta', term: 'Term 1', grade: 'C' },
        { id: 'report-ambiguous', student: 'Shared Name', term: 'Term 1', grade: 'B' },
      ],
      attendanceRecords: [{ studentId: 'STU-A', className: 'Class A', status: 'present' }],
    };

    const teacherView = schoolService.getTeacherSchoolView(school, {
      userId: `${SCHOOL_ID}:T-A`,
      roles: ['teacher'],
    });

    expect(teacherView.reportCards).toEqual([school.reportCards[0]]);
    expect(teacherView.students.map((student) => student.studentId)).toEqual(['STU-A', 'STU-C']);
    expect(teacherView.attendanceRecords).toEqual([
      { ...school.attendanceRecords[0], date: '', status: 'present' },
    ]);
  });

  it('limits teacher exam results to assigned students, classes, and subjects', () => {
    const school = {
      ...createSchool(),
      teachers: [{ teacherId: 'T-A', username: 'T-A', assignedClasses: ['class-a'], assignedSubjects: ['Math'] }],
      classes: [
        { classId: 'class-a', name: 'Class A', grade: 'Grade 10', teacherId: 'T-A' },
        { classId: 'class-b', name: 'Class B', grade: 'Grade 10', teacherId: 'T-B' },
      ],
      students: [
        { studentId: 'STU-A', fullName: 'Student Alpha', classId: 'class-a', className: 'Class A' },
        { studentId: 'STU-B', fullName: 'Student Beta', classId: 'class-b', className: 'Class B' },
      ],
      examResults: [
        { id: 'result-a', studentId: 'STU-A', className: 'Class A', subject: 'Math', mark: 95 },
        { id: 'result-b', studentId: 'STU-B', className: 'Class B', subject: 'Math', mark: 60 },
        { id: 'result-b-missing-class', studentId: 'STU-B', subject: 'Math', mark: 55 },
        { id: 'result-ambiguous-grade', className: 'Grade 10', subject: 'Math', mark: 50 },
        { id: 'result-mismatched-class', studentId: 'STU-A', className: 'Class B', subject: 'Math', mark: 70 },
        { id: 'result-mismatched-class-id', studentId: 'STU-A', classId: 'class-a', className: 'Class B', subject: 'Math', mark: 75 },
        { id: 'result-unassigned-student', studentId: 'STU-OTHER', subject: 'Math', mark: 65 },
        { id: 'result-science', studentId: 'STU-A', className: 'Class A', subject: 'Science', mark: 80 },
      ],
    };

    const teacherView = schoolService.getTeacherSchoolView(school, {
      userId: `${SCHOOL_ID}:T-A`,
      roles: ['teacher'],
    });

    expect(teacherView.examResults).toEqual([school.examResults[0]]);

    const bothClassesView = schoolService.getTeacherSchoolView({
      ...school,
      teachers: [{ ...school.teachers[0], assignedClasses: ['class-a', 'class-b'] }],
      examResults: [
        { id: 'result-a', studentId: 'STU-A', className: 'Class A', subject: 'Math', mark: 95 },
        { id: 'result-mismatched-assigned-class', studentId: 'STU-A', className: 'Class B', subject: 'Math', mark: 70 },
      ],
    }, {
      userId: `${SCHOOL_ID}:T-A`,
      roles: ['teacher'],
    });

    expect(bothClassesView.examResults).toEqual([
      { id: 'result-a', studentId: 'STU-A', className: 'Class A', subject: 'Math', mark: 95 },
    ]);
  });

  it('rejects exam results that pair an assigned student with another assigned class without changing existing results', () => {
    const existingResults = [
      { studentId: 'STU-A', student: 'Student Alpha', className: 'Class A', subject: 'Math', exam: 'Quiz 1', mark: 72 },
    ];
    const school = {
      ...createSchool(),
      teachers: [{ teacherId: 'T-GRADE', username: 'T-GRADE', assignedClasses: ['class-a', 'class-b'] }],
      classes: [
        { classId: 'class-a', name: 'Class A', grade: 'Grade 10' },
        { classId: 'class-b', name: 'Class B', grade: 'Grade 10' },
      ],
      students: [
        { studentId: 'STU-A', fullName: 'Student Alpha', classId: 'class-a', className: 'Class A', gradeLevel: 'Grade 10' },
        { studentId: 'STU-B', fullName: 'Student Beta', classId: 'class-b', className: 'Class B', gradeLevel: 'Grade 10' },
      ],
      examResults: existingResults,
    };
    const before = structuredClone(school.examResults);

    schoolService.updateTeacherWorkspace(school, { userId: `${SCHOOL_ID}:T-GRADE`, roles: ['teacher'] }, {
      examResults: [
        { studentId: 'STU-A', student: 'Student Alpha', className: 'Class B', subject: 'Math', exam: 'Quiz 1', mark: 100 },
        { studentId: 'STU-UNASSIGNED', student: 'Unassigned Student', className: 'Class A', subject: 'Math', exam: 'Quiz 1', mark: 100 },
      ],
    });

    expect(school.examResults).toEqual(before);
  });

  it('accepts exam results for students in their assigned classes', () => {
    const school = {
      ...createSchool(),
      teachers: [{ teacherId: 'T-GRADE', username: 'T-GRADE', assignedClasses: ['class-a', 'class-b'] }],
      classes: [
        { classId: 'class-a', name: 'Class A', grade: 'Grade 10' },
        { classId: 'class-b', name: 'Class B', grade: 'Grade 10' },
      ],
      students: [
        { studentId: 'STU-A', fullName: 'Student Alpha', classId: 'class-a', className: 'Class A', gradeLevel: 'Grade 10' },
        { studentId: 'STU-B', fullName: 'Student Beta', classId: 'class-b', className: 'Class B', gradeLevel: 'Grade 10' },
      ],
      examResults: [],
    };

    schoolService.updateTeacherWorkspace(school, { userId: `${SCHOOL_ID}:T-GRADE`, roles: ['teacher'] }, {
      examResults: [
        { studentId: 'STU-A', student: 'Student Alpha', className: 'Class A', subject: 'Math', exam: 'Quiz 1', mark: 80 },
        { studentId: 'STU-B', student: 'Student Beta', className: 'Class B', subject: 'Math', exam: 'Quiz 1', mark: 85 },
      ],
    });

    expect(school.examResults.map((entry) => [entry.studentId, entry.className, entry.mark])).toEqual([
      ['STU-A', 'Class A', 80],
      ['STU-B', 'Class B', 85],
    ]);
  });

  it('rejects a repeated external fee-payment reference without adding a second receipt', async () => {
    const school = {
      ...createSchool(),
      students: [{ studentId: 'fixture-student-1', fullName: 'Fixture Student', status: 'active' }],
      payments: [],
      receipts: [],
    };
    global.__workspaceSnapshot = [school];
    const paymentInput = {
      studentId: 'fixture-student-1',
      amount: 125,
      paymentDate: '2026-10-18',
      reference: 'BANK-REFERENCE-ONCE',
    };
    const actor = { userId: 'fixture-authority', roles: ['school_authority'] };

    const firstPayment = await schoolService.createFeePayment(SCHOOL_ID, paymentInput, actor);
    await expect(schoolService.createFeePayment(SCHOOL_ID, paymentInput, actor))
      .rejects.toThrow('Payment reference has already been recorded.');
    const secondPayment = await schoolService.createFeePayment(SCHOOL_ID, {
      ...paymentInput,
      reference: 'BANK-REFERENCE-TWO',
    }, actor);

    expect(secondPayment.payment.id).not.toBe(firstPayment.payment.id);
    expect(secondPayment.receipt.receiptNumber).not.toBe(firstPayment.receipt.receiptNumber);
    expect(global.__workspaceSnapshot[0].payments).toHaveLength(2);
    expect(global.__workspaceSnapshot[0].receipts).toHaveLength(2);
  });

  it.each([
    ['A active subscription', 'active', 'active', true],
    ['B trial subscription', 'active', 'trial', true],
    ['C expired subscription', 'active', 'expired', false],
    ['D suspended operational state', 'suspended', 'active', false],
    ['E suspended and expired', 'suspended', 'expired', false],
  ])('keeps operational state and access distinct for scenario %s', async (_label, schoolStatus, subscriptionStatus, allowed) => {
    const trialEndsAt = subscriptionStatus === 'trial'
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const resolved = schoolService.resolveSchoolLifecycleStatus({ ...createSchool(), schoolStatus, status: schoolStatus, subscriptionStatus, trialEndsAt });

    expect(resolved.schoolStatus).toBe(schoolStatus);
    expect(resolved.subscriptionStatus).toBe(subscriptionStatus);
    expect(schoolService.isSchoolAccessAllowed(resolved)).toBe(allowed);
  });

  it('maps the legacy Prisma trial status to an active operational state', () => {
    const resolved = schoolService.resolveSchoolLifecycleStatus({ status: 'trial', trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });

    expect(resolved.schoolStatus).toBe('active');
    expect(resolved.status).toBe('trial');
    expect(resolved.subscriptionStatus).toBe('trial');
  });

  it('does not infer operational suspension from an expired-only legacy record', () => {
    const resolved = schoolService.resolveSchoolLifecycleStatus({ status: 'expired' });

    expect(resolved.schoolStatus).toBe('active');
    expect(resolved.subscriptionStatus).toBe('expired');
    expect(schoolService.isSchoolAccessAllowed(resolved)).toBe(false);
  });

  it('denies an expired paid subscription while preserving the school data', () => {
    const school = {
      ...createSchool(),
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      students: [{ studentId: 'student-1' }],
    };

    const resolved = schoolService.resolveSchoolLifecycleStatus(school);

    expect(resolved.subscriptionStatus).toBe('expired');
    expect(schoolService.isSchoolAccessAllowed(resolved)).toBe(false);
    expect(resolved.students).toEqual(school.students);
    expect(school.subscriptionStatus).toBe('active');
  });

  it('allows a paid subscription until its expiry date', () => {
    const resolved = schoolService.resolveSchoolLifecycleStatus({
      ...createSchool(),
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(resolved.subscriptionStatus).toBe('active');
    expect(schoolService.isSchoolAccessAllowed(resolved)).toBe(true);
  });

  it('returns derived expiry from Prisma updates without persisting the derived status', async () => {
    const originalStub = prisma.__stub;
    const tenant = {
      id: 'prisma-expired-tenant',
      schoolId: SCHOOL_ID,
      status: 'active',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    const updateTenant = jest.spyOn(prisma.tenant, 'update').mockResolvedValue(tenant);
    jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(false);
    prisma.__stub = false;

    try {
      const updated = await schoolService.updateSchool(tenant.id, { name: 'Updated school name' });

      expect(updated.subscriptionStatus).toBe('expired');
      expect(updateTenant).toHaveBeenCalledWith({ where: { id: tenant.id }, data: { name: 'Updated school name' } });
      expect(tenant.subscriptionStatus).toBe('active');
    } finally {
      prisma.__stub = originalStub;
    }
  });

  it('suspends and activates operational state without changing subscription state', async () => {
    const trialEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    global.__workspaceSnapshot = [{ ...createSchool(), trialEndsAt }];

    const suspended = await schoolService.deleteSchool(SCHOOL_ID);
    expect(suspended.schoolStatus).toBe('suspended');
    expect(suspended.subscriptionStatus).toBe('trial');

    const activated = await schoolService.activateSchool(SCHOOL_ID);
    expect(activated.schoolStatus).toBe('active');
    expect(activated.subscriptionStatus).toBe('trial');
    expect(activated.trialEndsAt).toBe(trialEndsAt);
  });

  it('suspends the existing Firebase tenant without changing subscription state', async () => {
    const tenant = { ...createSchool(), trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    const firebaseMode = jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
    jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(tenant);
    const saveTenant = jest.spyOn(firebaseCore, 'saveTenant').mockImplementation(async (schoolId, updates) => ({ ...tenant, ...updates, schoolId }));

    const suspended = await schoolService.deleteSchool(SCHOOL_ID);

    expect(saveTenant).toHaveBeenCalledWith(SCHOOL_ID, { schoolStatus: 'suspended', status: 'suspended' });
    expect(suspended.schoolStatus).toBe('suspended');
    expect(suspended.status).toBe('suspended');
    expect(suspended.subscriptionStatus).toBe('trial');
    expect(suspended.trialEndsAt).toBe(tenant.trialEndsAt);
    firebaseMode.mockRestore();
    jest.restoreAllMocks();
  });

  it('does not create a Firebase tenant when the suspend target is missing', async () => {
    const firebaseMode = jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
    jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(null);
    const saveTenant = jest.spyOn(firebaseCore, 'saveTenant');

    await expect(schoolService.deleteSchool(SCHOOL_ID)).rejects.toThrow('School not found');
    expect(saveTenant).not.toHaveBeenCalled();
    firebaseMode.mockRestore();
    jest.restoreAllMocks();
  });

  it('reactivates operational status without renewing an expired paid subscription', async () => {
    const expiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    global.__workspaceSnapshot = [{
      ...createSchool(),
      schoolStatus: 'suspended',
      status: 'suspended',
      subscriptionStatus: 'active',
      expiresAt,
      payments: [{ id: 'payment-verified-1', status: 'activated' }],
      subscriptions: [{ status: 'active', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }],
    }];

    const activated = await schoolService.activateSchool(SCHOOL_ID);

    expect(activated.schoolStatus).toBe('active');
    expect(activated.status).toBe('active');
    expect(activated.subscriptionStatus).toBe('expired');
    expect(activated.expiresAt).toBe(expiresAt);
    expect(activated.payments).toEqual(global.__workspaceSnapshot[0].payments);
    expect(activated.subscriptions).toEqual(global.__workspaceSnapshot[0].subscriptions);
    expect(schoolService.isSchoolAccessAllowed(activated)).toBe(false);
  });

  it('keeps Firebase activation separate from expired subscription state', async () => {
    const trialEndsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const tenant = { ...createSchool(), schoolStatus: 'suspended', status: 'suspended', subscriptionStatus: 'expired', trialEndsAt };
    const firebaseMode = jest.spyOn(firebaseCore, 'isFirebaseCoreMode').mockReturnValue(true);
    const getTenant = jest.spyOn(firebaseCore, 'getTenant').mockResolvedValue(tenant);
    const saveTenant = jest.spyOn(firebaseCore, 'saveTenant').mockImplementation(async (schoolId, updates) => ({ ...tenant, ...updates, schoolId }));

    const activated = await schoolService.activateSchool(SCHOOL_ID);

    expect(activated.schoolStatus).toBe('active');
    expect(activated.status).toBe('active');
    expect(activated.subscriptionStatus).toBe('expired');
    expect(activated.trialEndsAt).toBe(trialEndsAt);
    expect(saveTenant.mock.calls[0][1]).not.toHaveProperty('subscriptionStatus');
    expect(saveTenant.mock.calls[0][1]).not.toHaveProperty('trialEndsAt');
    getTenant.mockRestore();
    saveTenant.mockRestore();
    firebaseMode.mockRestore();
  });

  it('restores only archive state and preserves status and related data', async () => {
    await schoolService.archiveSchool(SCHOOL_ID);
    const restored = await schoolService.restoreSchool(SCHOOL_ID);

    expect(restored.archivedAt).toBeNull();
    expect(restored.schoolStatus).toBe('active');
    expect(restored.status).toBe('active');
    expect(restored.subscriptionStatus).toBe('trial');
    expect(restored.users).toHaveLength(1);
    expect(restored.payments).toHaveLength(1);
    expect((await schoolService.listSchools()).map((school) => school.schoolId)).toEqual([SCHOOL_ID]);
    expect(await schoolService.listArchivedSchools()).toEqual([]);
  });

  it('denies archived tenant access without blocking the tenantless platform-admin path', async () => {
    const firebaseMode = jest.spyOn(firebaseData, 'isFirebaseDataConfigured').mockReturnValue(false);
    try {
      await schoolService.archiveSchool(SCHOOL_ID);

      const tenantReq = {
        user: { roles: ['school_authority'], tenantId: SCHOOL_ID, schoolId: SCHOOL_ID },
        params: { schoolId: SCHOOL_ID },
        body: {},
        headers: {},
      };
      const tenantRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const tenantNext = jest.fn();
      await tenantMiddleware(tenantReq, tenantRes, tenantNext);

      expect(tenantRes.status).toHaveBeenCalledWith(403);
      expect(tenantRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SCHOOL_ARCHIVED' }));
      expect(tenantNext).not.toHaveBeenCalled();

      const adminNext = jest.fn();
      await tenantMiddleware({
        user: { roles: ['super_admin'], platformAdmin: true, tenantId: null, schoolId: null },
        params: { schoolId: SCHOOL_ID },
        body: {},
        headers: {},
      }, tenantRes, adminNext);
      expect(adminNext).toHaveBeenCalledTimes(1);
    } finally {
      firebaseMode.mockRestore();
    }
  });

  it('blocks access to an expired paid school without removing its records', async () => {
    const payments = [{ id: 'payment-verified-1', status: 'activated' }];
    const subscriptions = [{ status: 'active', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }];
    const school = {
      ...createSchool(),
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      students: [{ studentId: 'student-1' }],
      payments,
      subscriptions,
    };
    global.__workspaceSnapshot = [school];
    const req = {
      user: { roles: ['school_authority'], tenantId: SCHOOL_ID, schoolId: SCHOOL_ID },
      params: { schoolId: SCHOOL_ID },
      body: {},
      headers: {},
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await tenantMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_EXPIRED' }));
    expect(next).not.toHaveBeenCalled();
    expect(global.__workspaceSnapshot[0].students).toEqual(school.students);
    expect(global.__workspaceSnapshot[0].payments).toEqual(payments);
    expect(global.__workspaceSnapshot[0].subscriptions).toEqual(subscriptions);
    expect(global.__workspaceSnapshot[0].subscriptionStatus).toBe('active');
  });

  it('blocks permanent deletion unless the school is archived', async () => {
    await expect(schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_NOT_ARCHIVED' });
    expect(global.__workspaceSnapshot).toHaveLength(1);
  });

  it('returns not found for a missing permanent-delete target without changing the fallback store', async () => {
    global.__workspaceSnapshot = [];

    await expect(schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_NOT_FOUND' });
    expect(global.__workspaceSnapshot).toEqual([]);
  });

  it('blocks permanent deletion of an archived fallback aggregate with related records', async () => {
    await schoolService.archiveSchool(SCHOOL_ID);

    await expect(schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
    expect(global.__workspaceSnapshot).toHaveLength(1);
    expect(global.__workspaceSnapshot[0].users).toHaveLength(1);
  });

  it('permanently removes an empty archived fallback aggregate', async () => {
    global.__workspaceSnapshot = [{
      ...createSchool(),
      users: [],
      classes: [],
      payments: [],
      subscriptions: [],
    }];
    await schoolService.archiveSchool(SCHOOL_ID);
    const deleted = await schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID);

    expect(deleted.schoolId).toBe(SCHOOL_ID);
    expect(global.__workspaceSnapshot).toEqual([]);
    expect(await schoolService.listSchools()).toEqual([]);
    expect(await schoolService.listArchivedSchools()).toEqual([]);
  });

  it('blocks mocked Prisma permanent deletion when tenant-scoped dependencies exist', async () => {
    await withMockPrismaDeletion({ dependencyModel: 'user' }, async ({ countMocks, deleteTenant }) => {
      await expect(schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID))
        .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
      expect(countMocks.user).toHaveBeenCalledWith({ where: { tenantId: 'prisma-archive-tenant-id' } });
      expect(deleteTenant).not.toHaveBeenCalled();
    });
  });

  it('deletes only an empty archived Prisma fixture', async () => {
    await withMockPrismaDeletion({}, async ({ deleteTenant }) => {
      const deleted = await schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID);

      expect(deleted).toEqual({ schoolId: SCHOOL_ID, name: 'Prisma Archive Fixture' });
      expect(deleteTenant).toHaveBeenCalledWith({ where: { id: 'prisma-archive-tenant-id' } });
    });
  });

  it('maps a Prisma foreign-key rejection to a dependency-protection error', async () => {
    await withMockPrismaDeletion({ deleteError: { code: 'P2003' } }, async ({ deleteTenant }) => {
      await expect(schoolService.permanentlyDeleteArchivedSchool(SCHOOL_ID))
        .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
      expect(deleteTenant).toHaveBeenCalledTimes(1);
    });
  });
});