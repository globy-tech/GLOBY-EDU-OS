const schoolService = require('../school.service');
const { ensureDemoSchool, loadSchoolData, saveSchoolData } = require('../fallback.school');

function getFutureDueDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

describe('academic workflow', () => {
  const schoolId = 'globy-school';

  beforeEach(() => {
    ensureDemoSchool();
    const snapshot = JSON.parse(JSON.stringify(loadSchoolData()));
    global.__workspaceSnapshot = snapshot;
    const school = snapshot.find((entry) => entry.schoolId === schoolId);
    if (!school) throw new Error('Demo school not found');
    school.assignments = [];
    school.lessons = [];
  });

  afterEach(() => {
    const snapshot = JSON.parse(JSON.stringify(global.__workspaceSnapshot || []));
    saveSchoolData(snapshot);
    delete global.__workspaceSnapshot;
  });

  it('teacher can create and view assignments for an authorized class', async () => {
    const teacher = { userId: `${schoolId}:T001`, roles: ['teacher'], schoolId, username: 'T001' };
    const assignment = await schoolService.createAssignment(schoolId, {
      title: 'Algebra Quiz',
      description: 'Solve the first five algebra questions.',
      classId: 'JHS-3A',
      subject: 'Mathematics',
      dueDate: getFutureDueDate(),
      teacherId: 'T001',
      createdBy: 'T001',
    }, teacher);

    expect(assignment.title).toBe('Algebra Quiz');
    const result = await schoolService.listAssignments(schoolId, { teacherId: 'T001' }, teacher);
    expect(result.items.some((item) => item.id === assignment.id)).toBe(true);
  });

  it('blocks unauthorized teacher access to another teacher class', async () => {
    const teacher = { userId: `${schoolId}:T999`, roles: ['teacher'], schoolId, username: 'T999' };
    await expect(schoolService.createAssignment(schoolId, {
      title: 'Unauthorized assignment',
      description: 'This should fail.',
      classId: 'JHS-3A',
      subject: 'Mathematics',
      dueDate: getFutureDueDate(),
      teacherId: 'T999',
      createdBy: 'T999',
    }, teacher)).rejects.toThrow('not authorized');
  });

  it('student can see only their own class assignments and submit them', async () => {
    const futureDueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const school = loadSchoolData().find((entry) => entry.schoolId === schoolId);
    school.assignments = [{
      id: 'assignment-1',
      title: 'JHS 3 Algebra',
      description: 'Solve the review set.',
      classId: 'JHS-3A',
      subject: 'Mathematics',
      dueDate: futureDueDate,
      status: 'assigned',
      teacherId: 'T001',
      createdBy: 'T001',
      submissions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    saveSchoolData(loadSchoolData());

    const student = { userId: `${schoolId}:STU001`, roles: ['student'], schoolId, username: 'STU001' };
    const items = await schoolService.listAssignmentsForStudent(schoolId, { studentId: 'STU001' }, student);
    expect(items.items).toHaveLength(1);

    const submitted = await schoolService.submitAssignment(schoolId, 'assignment-1', {
      studentId: 'STU001',
      text: 'Completed algebra review.',
    }, student);
    expect(submitted.submissions[0].status).toBe('submitted');
    expect(submitted.submissions[0].studentId).toBe('STU001');
  });

  it('teacher can see student submission status', async () => {
    const school = loadSchoolData().find((entry) => entry.schoolId === schoolId);
    school.assignments = [{
      id: 'assignment-2',
      title: 'History Quiz',
      description: 'Read chapters 1-3.',
      classId: 'JHS-3A',
      subject: 'History',
      dueDate: getFutureDueDate(),
      status: 'assigned',
      teacherId: 'T001',
      createdBy: 'T001',
      submissions: [{
        id: 'submission-1',
        studentId: 'STU001',
        studentName: 'Test Student',
        text: 'Submitted quiz answers',
        status: 'submitted',
        submittedAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    saveSchoolData(loadSchoolData());

    const teacher = { userId: `${schoolId}:T001`, roles: ['teacher'], schoolId, username: 'T001' };
    const result = await schoolService.getAssignmentSubmissions(schoolId, 'assignment-2', teacher);
    expect(result.submissions).toHaveLength(1);
    expect(result.submissions[0].status).toBe('submitted');
  });

  it('prevents students from modifying teacher assignment definitions', async () => {
    const school = loadSchoolData().find((entry) => entry.schoolId === schoolId);
    school.assignments = [{
      id: 'assignment-3',
      title: 'Original question',
      description: 'Do this.',
      classId: 'JHS-3A',
      subject: 'Science',
      dueDate: getFutureDueDate(),
      teacherId: 'T001',
      createdBy: 'T001',
      submissions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    saveSchoolData(loadSchoolData());

    const student = { userId: `${schoolId}:STU001`, roles: ['student'], schoolId, username: 'STU001' };
    await expect(schoolService.updateAssignment(schoolId, 'assignment-3', { title: 'Changed by student' }, student)).rejects.toThrow('not permitted');
  });

  it('teacher can create materials and student can see authorized material', async () => {
    const teacher = { userId: `${schoolId}:T001`, roles: ['teacher'], schoolId, username: 'T001' };
    const material = await schoolService.createLesson(schoolId, {
      title: 'Fractions Overview',
      description: 'Intro to fractions.',
      content: 'Fractions represent parts of a whole.',
      classId: 'JHS-3A',
      subject: 'Mathematics',
      teacherId: 'T001',
      createdBy: 'T001',
    }, teacher);

    expect(material.title).toBe('Fractions Overview');

    const student = { userId: `${schoolId}:STU001`, roles: ['student'], schoolId, username: 'STU001' };
    const list = await schoolService.listLessonsForStudent(schoolId, { studentId: 'STU001' }, student);
    expect(list.items.some((item) => item.id === material.id)).toBe(true);
  });

  it('blocks unauthorized or cross-tenant material access', async () => {
    const otherStudent = { userId: 'other-school:STU001', roles: ['student'], schoolId: 'other-school', username: 'STU001' };
    await expect(schoolService.listLessonsForStudent('other-school', { studentId: 'STU001' }, otherStudent)).rejects.toThrow('not found');

    const school = loadSchoolData().find((entry) => entry.schoolId === schoolId);
    school.lessons = [{
      id: 'lesson-1',
      title: 'Hidden lesson',
      classId: 'JHS-3A',
      subject: 'English',
      teacherId: 'T001',
      createdBy: 'T001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    saveSchoolData(loadSchoolData());

    const student = { userId: `${schoolId}:STU999`, roles: ['student'], schoolId, username: 'STU999' };
    const list = await schoolService.listLessonsForStudent(schoolId, { studentId: 'STU999' }, student);
    expect(list.items).toHaveLength(0);
  });
});
