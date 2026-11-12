jest.mock('../../../firebase.core', () => ({
  isFirebaseCoreMode: () => true,
  getSchoolAggregate: jest.fn(),
  commitAcademicProgression: jest.fn(),
}));

const firebaseCore = require('../../../firebase.core');
const progressionService = require('../academic-progression.service');

const SCHOOL_ID = 'progression-firebase-school';
const authority = {
  userId: `${SCHOOL_ID}:AUTH-1`,
  username: 'AUTH-1',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
  schoolId: SCHOOL_ID,
};

const school = {
  id: SCHOOL_ID,
  schoolId: SCHOOL_ID,
  academicYears: [
    { id: 'year-source', label: '2025/2026' },
    { id: 'year-target', label: '2026/2027' },
  ],
  academicStructure: { progressionPaths: { JHS: ['JHS 1', 'JHS 2'] } },
  classes: [
    { classId: 'class-source', id: 'class-source', name: 'JHS 1 Blue', grade: 'JHS 1', section: 'Blue', academicYearId: 'year-source', studentIds: ['STD-FIREBASE-1'] },
    { classId: 'class-target', id: 'class-target', name: 'JHS 2 Blue', grade: 'JHS 2', section: 'Blue', academicYearId: 'year-target', studentIds: [] },
  ],
  students: [{
    id: `${SCHOOL_ID}:STD-FIREBASE-1`,
    studentId: 'STD-FIREBASE-1',
    fullName: 'Firebase Student',
    email: 'firebase.student@example.test',
    status: 'active',
    classId: 'class-source',
    className: 'JHS 1 Blue',
    academicYearId: 'year-source',
    currentAcademicYear: 'year-source',
    metadata: { classId: 'class-source', academicYearId: 'year-source' },
  }],
  users: [{
    id: `${SCHOOL_ID}:firebase.student@example.test`,
    username: 'firebase.student@example.test',
    email: 'firebase.student@example.test',
    studentId: 'STD-FIREBASE-1',
    role: 'student',
    status: 'active',
  }],
  enrollments: [{
    id: `${SCHOOL_ID}:enrollment-source`,
    studentId: 'STD-FIREBASE-1',
    academicYearId: 'year-source',
    classId: 'class-source',
    status: 'active',
    isCurrent: true,
  }],
};

beforeEach(() => {
  school.students[0].classId = 'class-source';
  school.students[0].className = 'JHS 1 Blue';
  school.students[0].academicYearId = 'year-source';
  school.students[0].currentAcademicYear = 'year-source';
  school.students[0].status = 'active';
  school.students[0].metadata = { classId: 'class-source', academicYearId: 'year-source' };
  school.classes[0].studentIds = ['STD-FIREBASE-1'];
  school.classes[1].studentIds = [];
  school.enrollments = [{
    id: `${SCHOOL_ID}:enrollment-source`,
    studentId: 'STD-FIREBASE-1',
    academicYearId: 'year-source',
    classId: 'class-source',
    status: 'active',
    isCurrent: true,
  }];
  firebaseCore.getSchoolAggregate.mockResolvedValue(school);
  firebaseCore.commitAcademicProgression.mockReset().mockResolvedValue({ idempotent: false });
});

test('commits Firebase student, class, and enrollment changes through one atomic operation', async () => {
  const result = await progressionService.confirmProgression(SCHOOL_ID, {
    fromAcademicYearId: 'year-source',
    targetAcademicYearId: 'year-target',
    operationId: 'firebase-progression-1',
    confirmed: true,
    decisions: [{ studentId: 'STD-FIREBASE-1', action: 'promote' }],
  }, authority);

  expect(result.results).toEqual([{ studentId: 'STD-FIREBASE-1', action: 'promote', idempotent: false }]);
  expect(firebaseCore.commitAcademicProgression).toHaveBeenCalledWith(expect.objectContaining({
    schoolId: SCHOOL_ID,
    studentId: 'STD-FIREBASE-1',
    fromAcademicYearId: 'year-source',
    sourceClassId: 'class-source',
    targetAcademicYearId: 'year-target',
    targetClassId: 'class-target',
    operationId: 'firebase-progression-1',
    action: 'promote',
    student: expect.objectContaining({
      studentId: 'STD-FIREBASE-1',
      classId: 'class-target',
      academicYearId: 'year-target',
      metadata: expect.objectContaining({
        progressionHistory: [expect.objectContaining({ operationId: 'firebase-progression-1' })],
      }),
    }),
    userId: 'firebase.student@example.test',
    user: expect.objectContaining({ classId: 'class-target', academicYearId: 'year-target' }),
    targetEnrollment: expect.objectContaining({
      studentId: 'STD-FIREBASE-1',
      classId: 'class-target',
      academicYearId: 'year-target',
      progressionOperationId: 'firebase-progression-1',
    }),
  }));
  expect(school.enrollments).toEqual(expect.arrayContaining([
    expect.objectContaining({ classId: 'class-source', isCurrent: false, status: 'completed' }),
    expect.objectContaining({ classId: 'class-target', isCurrent: true, status: 'active' }),
  ]));
});
