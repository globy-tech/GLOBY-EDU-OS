const mockFallbackState = { schools: [] };

jest.mock('../../../firebase.core', () => ({ isFirebaseCoreMode: () => false }));
jest.mock('../fallback.school', () => ({
  loadSchoolData: jest.fn(() => mockFallbackState.schools),
  saveSchoolData: jest.fn((schools) => { mockFallbackState.schools = schools; }),
  findSchoolBySchoolId: jest.fn((schools, schoolId) => schools.find((school) => school.schoolId === schoolId) || null),
  ensureSchoolEntities: jest.fn((school) => {
    if (!Array.isArray(school.users)) school.users = [];
    if (!Array.isArray(school.teachers)) school.teachers = [];
    if (!Array.isArray(school.students)) school.students = [];
    if (!Array.isArray(school.classes)) school.classes = [];
    if (!Array.isArray(school.assignments)) school.assignments = [];
    if (!Array.isArray(school.lessons)) school.lessons = [];
    return school;
  }),
}));

const schoolService = require('../school.service');
const fallbackSchool = require('../fallback.school');

const SCHOOL_ID = 'fallback-school';
const student = {
  userId: `${SCHOOL_ID}:STU001`,
  username: 'STU001',
  schoolId: SCHOOL_ID,
  tenantId: SCHOOL_ID,
  roles: ['student'],
};

function createSchool(dueDate) {
  return {
    schoolId: SCHOOL_ID,
    users: [],
    teachers: [],
    classes: [{ classId: 'class-1', name: 'Class 1' }],
    students: [{ studentId: 'STU001', username: 'STU001', fullName: 'Student One', classId: 'class-1', className: 'Class 1' }],
    assignments: [{
      id: 'assignment-1',
      classId: 'class-1',
      className: 'Class 1',
      dueDate,
      status: 'assigned',
      submissions: [],
    }],
  };
}

beforeEach(() => {
  mockFallbackState.schools = [createSchool(new Date(Date.now() + 60_000).toISOString())];
  fallbackSchool.loadSchoolData.mockClear();
  fallbackSchool.saveSchoolData.mockClear();
});

describe('Fallback assignment submission deadline enforcement', () => {
  test('accepts an on-time submission while ignoring forged timestamp and student identity', async () => {
    const beforeSubmit = Date.now();

    const updated = await schoolService.submitAssignment(SCHOOL_ID, 'assignment-1', {
      studentId: 'SOMEONE-ELSE',
      studentName: 'Impersonated student',
      submittedAt: '2000-01-01T00:00:00.000Z',
      text: 'Completed on time.',
    }, student);

    const submission = updated.submissions[0];
    expect(submission.studentId).toBe('STU001');
    expect(submission.studentName).toBe('Student One');
    expect(new Date(submission.submittedAt).getTime()).toBeGreaterThanOrEqual(beforeSubmit);
    expect(submission.status).toBe('submitted');
    expect(fallbackSchool.saveSchoolData).toHaveBeenCalledTimes(1);
  });
});
