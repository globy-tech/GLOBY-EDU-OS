const schoolService = require('../school.service');
const { ensureDemoSchool, loadSchoolData, saveSchoolData } = require('../fallback.school');

describe('workspace messaging and support', () => {
  const schoolId = 'globy-school';

  afterEach(() => {
    const snapshot = JSON.parse(JSON.stringify(global.__workspaceSnapshot || []));
    saveSchoolData(snapshot);
    delete global.__workspaceSnapshot;
  });

  beforeEach(() => {
    ensureDemoSchool();
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = snapshot.find((entry) => entry.schoolId === schoolId) || null;
    if (school) {
      school.messages = [];
      school.supportTickets = [];
    }
    global.__workspaceSnapshot = snapshot;
  });

  it('persists a tenant-scoped message and returns it from the workspace list', async () => {
    const created = await schoolService.createWorkspaceMessage(schoolId, {
      subject: 'Welcome',
      body: 'Your school workspace is live.',
      folder: 'inbox',
      from: 'Super Admin',
      to: 'School Authority',
    });

    expect(created.subject).toBe('Welcome');
    const result = await schoolService.listWorkspaceMessages(schoolId, { folder: 'inbox' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].subject).toBe('Welcome');
  });

  it('stores support tickets for the requested school only', async () => {
    const created = await schoolService.createSupportTicket(schoolId, {
      title: 'Access issue',
      message: 'Please help me reset access.',
      priority: 'high',
    });

    expect(created.title).toBe('Access issue');
    const result = await schoolService.listSupportTickets(schoolId, { status: 'open' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('open');
  });

  it('derives dashboard metrics from the tenant’s real data and configured currency', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = (snapshot.find((entry) => entry.schoolId === schoolId) || snapshot[0]) || null;
    if (!school) throw new Error('School not found');

    school.settings = { ...(school.settings || {}), currency: 'GHS' };
    school.branding = { ...(school.branding || {}), currency: 'GHS' };
    school.users = [
      { username: 'head@demo.test', role: 'school_authority', fullName: 'Head', status: 'active' },
      { username: 't1', role: 'teacher', fullName: 'Teacher 1', status: 'active' },
      { username: 't2', role: 'teacher', fullName: 'Teacher 2', status: 'active' },
      { username: 's1', role: 'student', fullName: 'Student 1', status: 'active' },
      { username: 's2', role: 'student', fullName: 'Student 2', status: 'active' },
      { username: 'staff1', role: 'staff', fullName: 'Staff 1', status: 'active' }
    ];
    school.students = [
      { studentId: 'STD-001', fullName: 'Student 1', status: 'active' },
      { studentId: 'STD-002', fullName: 'Student 2', status: 'active' },
    ];
    school.teachers = [
      { teacherId: 'T-001', fullName: 'Teacher 1', status: 'active' },
      { teacherId: 'T-002', fullName: 'Teacher 2', status: 'active' },
    ];
    school.classes = [{ classId: 'class-1', name: 'JHS 1', status: 'active' }, { classId: 'class-2', name: 'JHS 2', status: 'active' }];
    school.attendanceRecords = [
      { date: '2026-08-23', status: 'present', studentName: 'Student 1' },
      { date: '2026-08-23', status: 'present', studentName: 'Student 2' },
      { date: '2026-08-23', status: 'absent', studentName: 'Student 3' },
    ];
    school.payments = [
      { amount: 1500, status: 'received', createdAt: '2026-08-23T09:00:00.000Z' },
      { amount: 2500, status: 'received', createdAt: '2026-08-23T10:00:00.000Z' },
      { amount: 1000, status: 'pending', createdAt: '2026-08-23T11:00:00.000Z' },
    ];
    school.recentActivities = [{ title: 'Student created', detail: 'Student 1 added.' }];
    school.events = [{ title: 'Open Day', detail: 'Parents invited.', date: '2026-08-30' }];
    school.announcements = [{ title: 'Welcome', detail: 'School reopened.' }];
    global.__workspaceSnapshot = snapshot;

    const result = await schoolService.getDashboardSummary(schoolId);

    expect(result.studentCount).toBe(2);
    expect(result.teacherCount).toBe(2);
    expect(result.staffCount).toBe(1);
    expect(result.classCount).toBe(2);
    expect(result.attendanceSummary.attendanceToday).toContain('67%');
    expect(result.feesSummary.collectedToday).toContain('GHS');
    expect(result.recentActivities[0].title).toBe('Student created');
    expect(result.upcomingEvents[0].title).toBe('Open Day');
  });

  it('keeps summary counts aligned with teacher and student users when derived collections are empty', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = (snapshot.find((entry) => entry.schoolId === schoolId) || snapshot[0]) || null;
    if (!school) throw new Error('School not found');

    school.users = [
      { username: 'head@demo.test', role: 'school_authority', fullName: 'Head', status: 'active' },
      { username: 't1', role: 'teacher', fullName: 'Teacher 1', status: 'active' },
      { username: 't2', role: 'teacher', fullName: 'Teacher 2', status: 'active' },
      { username: 's1', role: 'student', fullName: 'Student 1', status: 'active' },
    ];
    school.teachers = [];
    school.students = [];
    global.__workspaceSnapshot = snapshot;

    const result = await schoolService.getDashboardSummary(schoolId);

    expect(result.teacherCount).toBe(2);
    expect(result.studentCount).toBe(1);
  });

  it('counts only the current day for the attendance summary used by the school dashboard', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = (snapshot.find((entry) => entry.schoolId === schoolId) || snapshot[0]) || null;
    if (!school) throw new Error('School not found');

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    school.attendanceRecords = [
      { date: today, status: 'present', studentName: 'Student 1' },
      { date: today, status: 'present', studentName: 'Student 2' },
      { date: today, status: 'late', studentName: 'Student 3' },
      { date: today, status: 'excused', studentName: 'Student 4' },
      { date: yesterday, status: 'absent', studentName: 'Student 3' },
    ];
    global.__workspaceSnapshot = snapshot;

    const result = await schoolService.getDashboardSummary(schoolId);

    expect(result.attendanceSummary.counts).toEqual({ present: 3, absent: 1 });
    expect(result.attendanceSummary.attendanceToday).toBe('75%');
  });

  it('persists class relationships, teacher assignment, and suspension state in the tenant snapshot', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = snapshot.find((entry) => entry.schoolId === schoolId);
    if (!school) throw new Error('School not found');
    const originalSubscriptionStatus = school.subscriptionStatus;
    school.classes = [];
    school.teachers = [{ username: 'T001', teacherId: 'T001', fullName: 'Test Teacher', role: 'teacher', status: 'active' }];
    school.students = [];
    global.__workspaceSnapshot = snapshot;

    const createdClass = await schoolService.createEntity(schoolId, 'classes', { name: 'Class 1', status: 'active' });
    const assignedClass = await schoolService.updateEntity(schoolId, 'classes', createdClass.classId, { teacherId: 'T001', teacher: 'T001' });
    const createdStudent = await schoolService.createEntity(schoolId, 'students', {
      fullName: 'Class One Student',
      email: 'class-one-student@example.test',
      classId: createdClass.classId,
      className: createdClass.name,
      profilePhoto: 'data:image/png;base64,valid-test-image',
    });

    const reloaded = await schoolService.getSchoolBySchoolId(schoolId);
    expect(assignedClass.teacherId).toBe('T001');
    expect(createdStudent.classId).toBe(createdClass.classId);
    expect(reloaded.classes.find((item) => item.classId === createdClass.classId).teacherId).toBe('T001');
    expect(reloaded.students.find((item) => item.studentId === createdStudent.studentId).profilePhoto).toContain('data:image/png');

    const suspended = await schoolService.deleteSchool(schoolId);
    expect(suspended.schoolStatus).toBe('suspended');
    expect(suspended.subscriptionStatus).toBe(originalSubscriptionStatus);
    expect((await schoolService.getSchoolBySchoolId(schoolId)).schoolStatus).toBe('suspended');
    const activated = await schoolService.activateSchool(schoolId);
    expect(activated.schoolStatus).toBe('active');
    expect(activated.subscriptionStatus).toBe(originalSubscriptionStatus);
    expect((await schoolService.getSchoolBySchoolId(schoolId)).schoolStatus).toBe('active');
  });

  it('projects only a teacher’s assigned classes, students, and attendance data', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = snapshot.find((entry) => entry.schoolId === schoolId);
    if (!school) throw new Error('School not found');
    school.teachers = [{ teacherId: 'T001', username: 'T001', fullName: 'Test Teacher', className: 'JHS 3', passwordHash: 'teacher-secret' }];
    school.classes = [
      { classId: 'JHS-3A', name: 'JHS 3A', teacher: 'T001', status: 'active' },
      { classId: 'JHS-2A', name: 'JHS 2A', teacher: 'T002', status: 'active' },
    ];
    school.students = [
      { studentId: 'STU001', fullName: 'Assigned Student', className: 'JHS 3', studentPasswordHash: 'student-secret' },
      { studentId: 'STU002', fullName: 'Other Student', className: 'JHS 2' },
    ];
    school.attendanceRecords = [
      { studentId: 'STU001', className: 'JHS 3', status: 'present' },
      { studentId: 'STU002', className: 'JHS 2', status: 'absent' },
    ];
    school.announcements = [
      { title: 'Teacher notice', audience: 'teachers' },
      { title: 'Everyone notice', audience: 'everyone' },
      { title: 'Student notice', audience: 'students' },
    ];
    school.messages = [
      { subject: 'Teacher message', recipientType: 'teachers' },
      { subject: 'Parent message', recipientType: 'parents' },
    ];
    global.__workspaceSnapshot = snapshot;

    const schoolView = await schoolService.getSchoolBySchoolId(schoolId);
    const teacherView = schoolService.getTeacherSchoolView(schoolView, {
      userId: `${schoolId}:T001`,
      roles: ['teacher'],
    });

    expect(teacherView.classes.map((entry) => entry.classId)).toEqual(['JHS-3A']);
    expect(teacherView.students.map((entry) => entry.studentId)).toEqual(['STU001']);
    expect(teacherView.attendanceRecords).toHaveLength(1);
    expect(teacherView.users).toEqual([]);
    expect(teacherView.teachers[0].passwordHash).toBeUndefined();
    expect(teacherView.students[0].studentPasswordHash).toBeUndefined();
    expect(teacherView.payments).toEqual([]);
    expect(teacherView.announcements.map((entry) => entry.title)).toEqual(['Teacher notice', 'Everyone notice']);
    expect(teacherView.messages.map((entry) => entry.subject)).toEqual(['Teacher message']);
  });

  it('matches teacher assignments stored by class ID', () => {
    const school = {
      schoolId,
      users: [{ username: 'T-ID', role: 'teacher', fullName: 'ID Teacher', assignedClasses: ['class-qa'], assignedSubjects: ['Science'] }],
      teachers: [],
      classes: [{ classId: 'class-qa', name: 'QA Science Class', grade: 'Grade 10' }],
      students: [{ studentId: 'STU-QA', fullName: 'QA Student', classId: 'class-qa', className: 'QA Science Class' }],
    };
    const view = schoolService.getTeacherSchoolView(school, { userId: `${schoolId}:T-ID`, roles: ['teacher'] });
    expect(view.classes.map((entry) => entry.classId)).toEqual(['class-qa']);
    expect(view.students.map((entry) => entry.studentId)).toEqual(['STU-QA']);
  });

  it('persists teacher attendance and marks only for assigned students without duplicates', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = snapshot.find((entry) => entry.schoolId === schoolId);
    if (!school) throw new Error('School not found');
    school.teachers = [{ teacherId: 'T001', username: 'T001', fullName: 'Test Teacher', className: 'JHS 3' }];
    school.classes = [{ classId: 'JHS-3A', name: 'JHS 3A', grade: 'JHS 3', teacher: 'T001', status: 'active' }];
    school.students = [{ studentId: 'STU001', fullName: 'Assigned Student', className: 'JHS 3' }, { studentId: 'STU002', fullName: 'Other Student', className: 'JHS 2' }];
    school.attendanceRecords = [{ date: '2026-09-05', className: 'JHS 2', studentId: 'STU002', status: 'excused' }];
    school.examResults = [{ studentId: 'STU002', student: 'Other Student', className: 'JHS 2', subject: 'Math', exam: 'Quiz 1', mark: 2, maxMarks: 10 }];
    global.__workspaceSnapshot = snapshot;

    const user = { userId: `${schoolId}:T001`, roles: ['teacher'] };
    const first = schoolService.updateTeacherWorkspace(school, user, {
      attendanceRecords: [{ date: '2026-09-05', className: 'JHS 3', studentId: 'STU001', studentName: 'Assigned Student', status: 'present' }],
      examResults: [{ studentId: 'STU001', student: 'Assigned Student', className: 'JHS 3', subject: 'Math', exam: 'Quiz 1', mark: 8, maxMarks: 10 }],
      teacherProfile: { position: 'Teacher' },
    });
    schoolService.updateTeacherWorkspace(first, user, {
      attendanceRecords: [{ date: '2026-09-05', className: 'JHS 3', studentId: 'STU001', studentName: 'Assigned Student', status: 'late' }],
      examResults: [{ studentId: 'STU001', student: 'Assigned Student', className: 'JHS 3', subject: 'Math', exam: 'Quiz 1', mark: 9, maxMarks: 10 }],
    });
    schoolService.updateTeacherWorkspace(first, user, {
      attendanceRecords: [
        { date: '2026-09-06', className: 'JHS 3', studentId: 'STU001', studentName: 'Assigned Student', status: 'absent' },
        { date: '2026-09-07', className: 'JHS 3', studentId: 'STU001', studentName: 'Assigned Student', status: 'unknown' },
        { date: 'not-a-date', className: 'JHS 3', studentId: 'STU001', studentName: 'Assigned Student', status: 'present' },
      ],
    });
    schoolService.updateTeacherWorkspace(first, user, {
      attendanceRecords: [{ date: '2026-09-05', className: 'JHS 2', studentId: 'STU002', studentName: 'Other Student', status: 'present' }],
    });

    expect(first.attendanceRecords).toHaveLength(3);
    expect(first.attendanceRecords.find((entry) => entry.studentId === 'STU001' && entry.date === '2026-09-05').status).toBe('present');
    expect(first.attendanceRecords.find((entry) => entry.studentId === 'STU001' && entry.date === '2026-09-06').status).toBe('absent');
    expect(first.attendanceRecords.find((entry) => entry.studentId === 'STU002').status).toBe('absent');
    expect(first.examResults).toHaveLength(2);
    expect(first.examResults.find((entry) => entry.studentId === 'STU001').mark).toBe(9);
    expect(first.examResults.find((entry) => entry.studentId === 'STU002').mark).toBe(2);
    expect(first.teachers[0].position).toBe('Teacher');
  });

  it('rejects a student class relationship that is not owned by the tenant', async () => {
    await expect(schoolService.createEntity(schoolId, 'students', {
      fullName: 'Invalid Student',
      email: 'invalid-student@example.test',
      classId: 'another-school-class',
    })).rejects.toThrow('Class does not belong to this school');
  });

  it('persists message audience metadata and school reports/settings for reload and admin review', async () => {
    const message = await schoolService.createWorkspaceMessage(schoolId, {
      folder: 'sent',
      from: 'School Authority',
      recipientType: 'students',
      subject: 'Student notice',
      body: 'Bring your exercise book.',
    });
    const messages = await schoolService.listWorkspaceMessages(schoolId, { folder: 'sent' });
    expect(messages.items[0]).toMatchObject({ id: message.id, recipientType: 'students', audience: 'students' });

    const school = await schoolService.getSchoolBySchoolId(schoolId);
    const reports = [{ title: 'Attendance review', type: 'attendance', summary: 'Reviewed.', status: 'submitted', submittedAt: new Date().toISOString(), schoolId }];
    const updated = await schoolService.updateSchool(school.id, {
      reports,
      settings: { ...(school.settings || {}), theme: 'light' },
    });
    const reloaded = await schoolService.getSchoolBySchoolId(schoolId);
    expect(updated.reports[0].schoolId).toBe(schoolId);
    expect(reloaded.reports[0]).toMatchObject({ title: 'Attendance review', status: 'submitted', schoolId });
    expect(reloaded.settings.theme).toBe('light');
  });

  it('authorizes role-based recipients and persists inbox, sent, and read state', async () => {
    const authority = { userId: `${schoolId}:authority@globyedu.test`, tenantId: schoolId, roles: ['school_authority'] };
    const teacher = { userId: `${schoolId}:T001`, tenantId: schoolId, roles: ['teacher'] };
    const student = { userId: `${schoolId}:STU001`, tenantId: schoolId, roles: ['student'] };

    const authorityRecipients = schoolService.getMessagingRecipientOptions(await schoolService.getSchoolBySchoolId(schoolId), authority);
    expect(authorityRecipients.some((recipient) => recipient.id === 'T001')).toBe(true);

    const sent = await schoolService.createWorkspaceMessage(schoolId, {
      recipientId: 'T001',
      subject: 'Staff update',
      body: 'Please review the timetable.',
    }, authority);
    expect(sent.recipientId).toBe('t001');
    expect((await schoolService.listWorkspaceMessages(schoolId, { folder: 'sent' }, authority)).items).toHaveLength(1);
    expect((await schoolService.listWorkspaceMessages(schoolId, { folder: 'inbox' }, teacher)).items[0]).toMatchObject({ id: sent.id, unread: true });

    await schoolService.updateWorkspaceMessage(schoolId, sent.id, { unread: false }, teacher);
    expect((await schoolService.listWorkspaceMessages(schoolId, { folder: 'inbox' }, teacher)).items[0].unread).toBe(false);
    await expect(schoolService.updateWorkspaceMessage(schoolId, sent.id, { unread: false }, student)).rejects.toThrow('Message access denied');
  });

  it('allows teacher and student communication only through authorized relationships', async () => {
    const teacher = { userId: `${schoolId}:T001`, tenantId: schoolId, roles: ['teacher'] };
    const student = { userId: `${schoolId}:STU001`, tenantId: schoolId, roles: ['student'] };

    const teacherMessage = await schoolService.createWorkspaceMessage(schoolId, { recipientId: 'STU001', subject: 'Classwork', body: 'Your assignment is ready.' }, teacher);
    expect((await schoolService.listWorkspaceMessages(schoolId, { folder: 'inbox' }, student)).items[0].id).toBe(teacherMessage.id);

    const studentMessage = await schoolService.createWorkspaceMessage(schoolId, { recipientId: 'T001', subject: 'Question', body: 'Could you clarify the exercise?' }, student);
    expect((await schoolService.listWorkspaceMessages(schoolId, { folder: 'inbox' }, teacher)).items.map((entry) => entry.id)).toContain(studentMessage.id);

    await expect(schoolService.createWorkspaceMessage(schoolId, { recipientId: 'unknown-user', subject: 'Private', body: 'Not allowed.' }, student)).rejects.toThrow('Recipient is not authorized');
    expect((await schoolService.listWorkspaceMessages(schoolId, { folder: 'inbox' }, authorityActor())).items).toHaveLength(0);
  });

  function authorityActor() {
    return { userId: `${schoolId}:authority@globyedu.test`, tenantId: schoolId, roles: ['school_authority'] };
  }

  it('projects only the authenticated student’s own school data and hides teacher/admin records', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = snapshot.find((entry) => entry.schoolId === schoolId);
    if (!school) throw new Error('School not found');

    school.teachers = [{ teacherId: 'T001', username: 'T001', fullName: 'Test Teacher', passwordHash: 'teacher-secret' }];
    school.classes = [
      { classId: 'JHS-3A', name: 'JHS 3A', grade: 'JHS 3', teacher: 'T001', students: ['STU001', 'STU002'], status: 'active' },
      { classId: 'JHS-2A', name: 'JHS 2A', grade: 'JHS 2', teacher: 'T002', status: 'active' },
    ];
    school.students = [
      { studentId: 'STU001', fullName: 'Test Student', className: 'JHS 3', email: 'student@globy.test', studentPasswordHash: 'student-secret' },
      { studentId: 'STU002', fullName: 'Test Student', className: 'JHS 3', email: 'other@globy.test' },
    ];
    school.attendanceRecords = [
      { date: '2026-09-05', className: 'JHS 3', studentId: 'STU001', status: 'present' },
      { date: '2026-09-05', className: 'JHS 3', studentId: 'STU002', status: 'absent' },
    ];
    school.examRecords = [
      { studentId: 'STU001', className: 'JHS 3', subject: 'Math', mark: 90 },
      { studentId: 'STU002', className: 'JHS 3', subject: 'Math', mark: 25 },
    ];
    school.examResults = [
      { studentId: 'STU001', student: 'Test Student', className: 'JHS 3', subject: 'Math', exam: 'Quiz 1', mark: 82, maxMarks: 100 },
      { studentId: 'STU002', student: 'Other Student', className: 'JHS 2', subject: 'Math', exam: 'Quiz 1', mark: 41, maxMarks: 100 },
    ];
    school.announcements = [
      { title: 'Student notice', audience: 'students' },
      { title: 'Everyone notice', audience: 'everyone' },
      { title: 'Teacher notice', audience: 'teachers' },
    ];
    school.messages = [
      { subject: 'Student inbox', recipientType: 'students' },
      { subject: 'Teacher inbox', recipientType: 'teachers' },
    ];
    school.payments = [
      { studentId: 'STU001', amount: 100, status: 'paid' },
      { studentId: 'STU002', amount: 200, status: 'paid' },
      { studentName: 'Test Student', amount: 300, status: 'paid' },
    ];
    global.__workspaceSnapshot = snapshot;

    const studentView = schoolService.getStudentSchoolView(school, {
      userId: `${schoolId}:STU001`,
      roles: ['student'],
    });

    expect(studentView.student.studentId).toBe('STU001');
    expect(studentView.classes.map((entry) => entry.classId)).toEqual(['JHS-3A']);
    expect(studentView.classes[0].students).toEqual(['STU001']);
    expect(studentView.students).toEqual([]);
    expect(studentView.teachers).toEqual([]);
    expect(studentView.attendanceRecords).toHaveLength(1);
    expect(studentView.attendanceRecords[0].studentId).toBe('STU001');
    expect(studentView.examRecords).toEqual([{ studentId: 'STU001', className: 'JHS 3', subject: 'Math', mark: 90 }]);
    expect(studentView.examResults).toHaveLength(1);
    expect(studentView.examResults[0].studentId).toBe('STU001');
    expect(studentView.announcements.map((entry) => entry.title)).toEqual(['Student notice', 'Everyone notice']);
    expect(studentView.messages.map((entry) => entry.subject)).toEqual(['Student inbox']);
    expect(studentView.payments).toEqual([{ studentId: 'STU001', amount: 100, status: 'paid' }]);
    expect(studentView.student.studentPasswordHash).toBeUndefined();
  });

  it('records a persistent tenant-scoped payment and receipt for an authorized school user', async () => {
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    const school = snapshot.find((entry) => entry.schoolId === schoolId);
    if (!school) throw new Error('School not found');
    school.students = [{ studentId: 'STU-FEE-001', fullName: 'Fee Student', className: 'JHS 1', status: 'active' }];
    school.payments = [];
    school.receipts = [];
    global.__workspaceSnapshot = snapshot;

    const result = await schoolService.createFeePayment(schoolId, {
      studentId: 'STU-FEE-001', amount: '125.50', feeType: 'Tuition', paymentDate: '2026-09-10',
      method: 'Bank', academicYear: '2026/2027', term: 'Term 1', reference: 'BANK-001',
    }, { userId: 'authority-1', roles: ['school_authority'] });

    expect(result.payment).toMatchObject({ schoolId, studentId: 'STU-FEE-001', amount: 125.5, receiptNumber: result.receipt.receiptNumber });
    expect(result.receipt).toMatchObject({ receiptNumber: expect.stringMatching(/^RCPT-2026-\d{6}$/), paymentId: result.payment.id });
    const reloaded = await schoolService.getSchoolBySchoolId(schoolId);
    expect(reloaded.payments[0].receiptNumber).toBe(result.receipt.receiptNumber);
    expect(schoolService.getStudentSchoolView(reloaded, { userId: `${schoolId}:STU-FEE-001`, roles: ['student'] }).payments).toHaveLength(1);
    await expect(schoolService.createFeePayment(schoolId, { studentId: 'STU-FEE-001', amount: 10 }, { userId: 'teacher-1', roles: ['teacher'] })).rejects.toThrow('permission');
  });
});
