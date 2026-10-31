const mockStore = { collections: new Map() };

function records(collection) {
  if (!mockStore.collections.has(collection)) mockStore.collections.set(collection, new Map());
  return mockStore.collections.get(collection);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => clone(value) };
}

const mockFirestore = {
  collection(name) {
    return {
      doc(id) {
        const documentId = String(id);
        return {
          id: documentId,
          get: async () => snapshot(documentId, records(name).get(documentId)),
          set: async (value, options = {}) => {
            const current = records(name).get(documentId);
            records(name).set(documentId, options.merge === false ? clone(value) : { ...(current || {}), ...clone(value) });
          },
          delete: async () => records(name).delete(documentId),
        };
      },
      where(field, operator, value) {
        return {
          get: async () => ({
            docs: Array.from(records(name).entries())
              .filter(([, item]) => operator === '==' && item[field] === value)
              .map(([id, item]) => ({ id, data: () => clone(item) })),
          }),
        };
      },
    };
  },
};

jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockFirestore,
}));
jest.mock('../../../config/prisma.client', () => ({ __stub: false }));
jest.mock('../fallback.school', () => {
  const actual = jest.requireActual('../fallback.school');
  return {
    ...actual,
    loadSchoolData: jest.fn(() => { throw new Error('Local JSON fallback must not be used in Firebase mode.'); }),
    saveSchoolData: jest.fn(() => { throw new Error('Local JSON fallback must not be used in Firebase mode.'); }),
  };
});

const schoolService = require('../school.service');
const firebaseCore = require('../../../firebase.core');
const fallbackSchool = require('../fallback.school');

function seedSchool(schoolId, classId, className, teacherId, studentId) {
  records('tenants').set(schoolId, { schoolId, id: schoolId, name: `${schoolId} Academy` });
  records('classes').set(`${schoolId}:${classId}`, {
    schoolId,
    classId,
    name: className,
    teacherId,
  });
  records('teachers').set(`${schoolId}:${teacherId}`, {
    schoolId,
    teacherId,
    username: teacherId,
    fullName: `${teacherId} Teacher`,
    assignedClasses: [classId, className],
    status: 'active',
  });
  records('students').set(`${schoolId}:${studentId}`, {
    schoolId,
    studentId,
    username: studentId,
    fullName: `${studentId} Student`,
    classId,
    className,
    status: 'active',
  });
  records('users').set(`${schoolId}:${teacherId}`, {
    schoolId,
    tenantId: schoolId,
    username: teacherId,
    teacherId,
    fullName: `${teacherId} Teacher`,
    role: 'teacher',
    roles: ['teacher'],
    status: 'active',
    assignedClasses: [classId, className],
  });
  records('users').set(`${schoolId}:${studentId}`, {
    schoolId,
    tenantId: schoolId,
    username: studentId,
    studentId,
    fullName: `${studentId} Student`,
    role: 'student',
    roles: ['student'],
    status: 'active',
    classId,
    className,
  });
}

const teacherA = { userId: 'school-a:T001', tenantId: 'school-a', schoolId: 'school-a', username: 'T001', roles: ['teacher'] };
const studentA = { userId: 'school-a:STU001', tenantId: 'school-a', schoolId: 'school-a', username: 'STU001', roles: ['student'] };
const teacherB = { userId: 'school-b:T002', tenantId: 'school-b', schoolId: 'school-b', username: 'T002', roles: ['teacher'] };
const studentB = { userId: 'school-b:STU002', tenantId: 'school-b', schoolId: 'school-b', username: 'STU002', roles: ['student'] };

beforeEach(() => {
  mockStore.collections.clear();
  seedSchool('school-a', 'class-a', 'Class A', 'T001', 'STU001');
  seedSchool('school-b', 'class-b', 'Class B', 'T002', 'STU002');
  fallbackSchool.loadSchoolData.mockClear();
  fallbackSchool.saveSchoolData.mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('Firebase persistence for assignments, lessons, and workspace messages', () => {
  test('persists assignments for reload, scopes student reads, and rejects unauthorized access', async () => {
    const assignment = await schoolService.createAssignment('school-a', {
      title: 'Class A assignment',
      classId: 'class-a',
      subject: 'Math',
    }, teacherA);

    const teacherReload = await schoolService.listAssignments('school-a', {}, teacherA);
    const studentReload = await schoolService.listAssignmentsForStudent('school-a', { studentId: 'STU001' }, studentA);
    const otherSchoolReload = await schoolService.listAssignments('school-b', {}, teacherB);
    const submitted = await schoolService.submitAssignment('school-a', assignment.id, { text: 'Completed.' }, studentA);
    const submissions = await schoolService.getAssignmentSubmissions('school-a', assignment.id, teacherA);

    expect(teacherReload.items).toEqual([expect.objectContaining({ id: assignment.id, schoolId: 'school-a' })]);
    expect(studentReload.items.map((item) => item.id)).toEqual([assignment.id]);
    expect(otherSchoolReload.items).toEqual([]);
    expect(submitted.submissions[0]).toMatchObject({ studentId: 'STU001', text: 'Completed.' });
    expect(submissions.submissions).toEqual(submitted.submissions);
    await expect(schoolService.createAssignment('school-a', { classId: 'class-b' }, teacherA)).rejects.toThrow('not authorized');
    await expect(schoolService.listAssignments('school-b', {}, teacherA)).rejects.toThrow('School access denied');
  });

  test('binds student assignment reads to the authenticated student and hides classmates submissions', async () => {
    const assignment = await schoolService.createAssignment('school-a', {
      title: 'Private submissions',
      classId: 'class-a',
    }, teacherA);
    records('students').set('school-a:STU002', {
      schoolId: 'school-a',
      studentId: 'STU002',
      username: 'STU002',
      classId: 'class-a',
      className: 'Class A',
      status: 'active',
    });
    await firebaseCore.saveById('assignments', `school-a:${assignment.id}`, {
      ...assignment,
      submissions: [
        { studentId: 'STU001', text: 'My own answer.' },
        { studentId: 'STU002', text: 'A classmate answer.' },
      ],
    });

    const result = await schoolService.listAssignmentsForStudent(
      'school-a',
      { studentId: 'STU002' },
      studentA,
    );

    expect(result.items[0].submissions).toEqual([{ studentId: 'STU001', text: 'My own answer.' }]);
  });

  test('accepts on-time submissions but uses the server timestamp and authenticated student', async () => {
    const assignment = await schoolService.createAssignment('school-a', {
      title: 'On-time assignment',
      classId: 'class-a',
      dueDate: new Date(Date.now() + 60_000).toISOString(),
    }, teacherA);
    const beforeSubmit = Date.now();

    const updated = await schoolService.submitAssignment('school-a', assignment.id, {
      studentId: 'STU002',
      studentName: 'Impersonated student',
      submittedAt: '2000-01-01T00:00:00.000Z',
      text: 'On time.',
    }, studentA);
    const submission = updated.submissions[0];

    expect(submission.studentId).toBe('STU001');
    expect(submission.studentName).toBe('STU001 Student');
    expect(submission.submittedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(new Date(submission.submittedAt).getTime()).toBeGreaterThanOrEqual(beforeSubmit);
    expect(submission.status).toBe('submitted');
  });

  test('rejects expired and cross-school assignment submissions without changing stored submissions', async () => {
    const expiredAssignment = await schoolService.createAssignment('school-a', {
      title: 'Expired assignment',
      classId: 'class-a',
      dueDate: new Date(Date.now() - 60_000).toISOString(),
    }, teacherA);
    const assignmentB = await schoolService.createAssignment('school-b', {
      title: 'School B assignment',
      classId: 'class-b',
      dueDate: new Date(Date.now() + 60_000).toISOString(),
    }, teacherB);

    await expect(schoolService.submitAssignment('school-a', expiredAssignment.id, {
      submittedAt: '2000-01-01T00:00:00.000Z',
      text: 'Forged early timestamp.',
    }, studentA)).rejects.toThrow('Assignment deadline has passed');
    await expect(schoolService.submitAssignment('school-a', expiredAssignment.id, {}, studentB))
      .rejects.toThrow('School access denied');
    await expect(schoolService.submitAssignment('school-a', assignmentB.id, {}, studentA))
      .rejects.toThrow('Assignment not found');

    const stored = await schoolService.listAssignments('school-a', {}, teacherA);
    expect(stored.items.find((item) => item.id === expiredAssignment.id).submissions).toEqual([]);
  });

  test('persists lessons for reload and returns only each student school/class content', async () => {
    const lessonA = await schoolService.createLesson('school-a', {
      title: 'Class A lesson',
      classId: 'class-a',
      subject: 'Math',
    }, teacherA);
    const lessonB = await schoolService.createLesson('school-b', {
      title: 'Class B lesson',
      classId: 'class-b',
      subject: 'Science',
    }, teacherB);

    const studentAItems = await schoolService.listLessonsForStudent('school-a', { studentId: 'STU001' }, studentA);
    const studentBItems = await schoolService.listLessonsForStudent('school-b', { studentId: 'STU002' }, studentB);
    await schoolService.updateLesson('school-a', lessonA.id, { content: 'Updated lesson content.' }, teacherA);
    const reloadedLesson = (await schoolService.listLessons('school-a', {}, teacherA)).items[0];

    expect(studentAItems.items.map((item) => item.id)).toEqual([lessonA.id]);
    expect(studentBItems.items.map((item) => item.id)).toEqual([lessonB.id]);
    expect(reloadedLesson.content).toBe('Updated lesson content.');
    await expect(schoolService.createLesson('school-a', { classId: 'class-b' }, teacherA)).rejects.toThrow('not authorized');
    await expect(schoolService.listLessons('school-b', {}, teacherA)).rejects.toThrow('School access denied');
  });

  test('does not report successful assignment creation when Firestore persistence fails', async () => {
    jest.spyOn(firebaseCore, 'saveById').mockRejectedValueOnce(new Error('Firestore write failed'));

    await expect(schoolService.createAssignment('school-a', {
      title: 'Unpersisted assignment',
      classId: 'class-a',
    }, teacherA)).rejects.toThrow('Firestore write failed');

    expect((await schoolService.listAssignments('school-a', {}, teacherA)).items).toEqual([]);
  });

  test('persists recipient-scoped messages, read state, and school isolation', async () => {
    const message = await schoolService.createWorkspaceMessage('school-a', {
      recipientId: 'STU001',
      subject: 'Class A notice',
      body: 'Please review the lesson.',
    }, teacherA);

    const inbox = await schoolService.listWorkspaceMessages('school-a', { folder: 'inbox' }, studentA);
    expect(inbox.items).toEqual([expect.objectContaining({ id: message.id, recipientId: 'stu001', unread: true })]);

    const updated = await schoolService.updateWorkspaceMessage('school-a', message.id, { unread: false }, studentA);
    expect(updated.unread).toBe(false);
    expect((await schoolService.listWorkspaceMessages('school-a', { folder: 'inbox' }, studentA).then((result) => result.items[0])).unread).toBe(false);
    expect((await schoolService.listWorkspaceMessages('school-b', { folder: 'inbox' }, studentB)).items).toEqual([]);
    await expect(schoolService.updateWorkspaceMessage('school-a', message.id, { unread: false }, studentB)).rejects.toThrow('School access denied');
    await expect(schoolService.deleteWorkspaceMessage('school-a', message.id, studentB)).rejects.toThrow('School access denied');
    const deleted = await schoolService.deleteWorkspaceMessage('school-a', message.id, teacherA);
    expect(deleted.id).toBe(message.id);
    expect((await schoolService.listWorkspaceMessages('school-a', {}, studentA)).items).toEqual([]);
    expect(fallbackSchool.loadSchoolData).not.toHaveBeenCalled();
    expect(fallbackSchool.saveSchoolData).not.toHaveBeenCalled();
  });
});
