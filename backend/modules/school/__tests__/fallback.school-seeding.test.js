const useIsolatedSchoolStore = require('./isolated-school-store');
const cleanupIsolatedSchoolStore = useIsolatedSchoolStore();
const { ensureDemoSchool } = require('../fallback.school');

describe('development school seeding', () => {
  afterAll(() => {
    cleanupIsolatedSchoolStore();
  });

  afterEach(() => {
    delete global.__workspaceSnapshot;
  });

  test('preserves existing role credentials when refreshing demo account metadata', () => {
    const credentials = {
      admin: 'existing-admin-password-hash',
      teacher: 'existing-teacher-password-hash',
      student: 'existing-student-password-hash',
    };
    global.__workspaceSnapshot = [{
      id: 'GLOBY-DEMO-001',
      schoolId: 'globy-school',
      name: 'Globy School',
      users: [
        { username: 'hellogloby@gmail.com', role: 'super_admin', passwordHash: credentials.admin, passwordNeedsReset: false },
        { username: 'T001', role: 'teacher', passwordHash: credentials.teacher, passwordNeedsReset: false },
        { username: 'STU001', role: 'student', studentPasswordHash: credentials.student, passwordNeedsReset: false },
      ],
      students: [],
    }];

    const school = ensureDemoSchool();

    const admin = school.users.find((user) => user.username === 'hellogloby@gmail.com');
    const teacher = school.users.find((user) => user.username === 'T001');
    const student = school.users.find((user) => user.username === 'STU001');

    expect(admin.passwordHash).toBe(credentials.admin);
    expect(admin.passwordNeedsReset).toBe(false);
    expect(teacher.passwordHash).toBe(credentials.teacher);
    expect(teacher.passwordNeedsReset).toBe(false);
    expect(student.studentPasswordHash).toBe(credentials.student);
    expect(student.passwordNeedsReset).toBe(false);
  });
});
