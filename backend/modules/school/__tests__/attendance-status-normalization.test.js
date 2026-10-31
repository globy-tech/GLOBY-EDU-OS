jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../config/prisma.client', () => ({ __stub: true }));

const schoolService = require('../school.service');

describe('teacher attendance status normalization', () => {
  test.each([
    ['present', 'present'],
    ['absent', 'absent'],
    ['late', 'late'],
  ])('preserves %s attendance as %s', (inputStatus, expectedStatus) => {
    const school = {
      id: 'attendance-qa',
      schoolId: 'attendance-qa',
      users: [],
      teachers: [{
        teacherId: 'T-QA-01',
        username: 'T-QA-01',
        role: 'teacher',
        assignedClasses: ['class-qa-01'],
      }],
      students: [{
        studentId: 'STU-QA-01',
        username: 'STU-QA-01',
        classId: 'class-qa-01',
        className: 'Class 1',
      }],
      classes: [{
        classId: 'class-qa-01',
        name: 'Class 1',
        teacherId: 'T-QA-01',
      }],
      attendanceRecords: [],
    };
    const teacher = {
      userId: 'attendance-qa:T-QA-01',
      username: 'T-QA-01',
      tenantId: 'attendance-qa',
      roles: ['teacher'],
    };

    const updated = schoolService.updateTeacherWorkspace(school, teacher, {
      attendanceRecords: [{
        studentId: 'STU-QA-01',
        classId: 'class-qa-01',
        className: 'Class 1',
        date: '2026-10-28',
        status: inputStatus,
      }],
    });

    expect(updated.attendanceRecords).toContainEqual(expect.objectContaining({
      studentId: 'STU-QA-01',
      status: expectedStatus,
    }));
  });
});
