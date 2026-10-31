const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const authConfig = require('../backend/config/auth.config');

const repositoryRoot = path.resolve(__dirname, '..');
const qaHome = path.resolve(process.env.GLOBY_QA_HOME || path.join(process.env.LOCALAPPDATA || os.homedir(), 'GlobyEdu-QA'));
const schoolId = 'GLB-QA-2026-TEST01';
const secondarySchoolId = 'GLB-QA-2026-TEST02';
const schoolName = 'Globy Isolated QA School';

function assertSafeTarget() {
  const relative = path.relative(repositoryRoot, qaHome);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('QA_HOME must be outside the repository.');
  }
  if (fs.existsSync(qaHome)) throw new Error('QA_HOME already exists; refusing to overwrite or reset existing QA files.');
  if (!process.env.LOCALAPPDATA && !process.env.GLOBY_QA_HOME) {
    throw new Error('Set LOCALAPPDATA or GLOBY_QA_HOME to an explicit local QA folder.');
  }
}

function writeNewFile(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function provision() {
  assertSafeTarget();
  const password = `QA-${crypto.randomBytes(24).toString('base64url')}-Aa1!`;
  const passwordHash = await bcrypt.hash(password, authConfig.bcrypt.saltRounds);
  const now = new Date();
  const classRows = Array.from({ length: 4 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      classId: `QA-CLASS-${number}`,
      name: `Class ${index + 1}`,
      grade: `Grade ${index + 1}`,
      teacherId: `T-00${index + 1}-${['BAD', 'KOO', 'HIB', 'JUN'][index]}`,
      students: Array.from({ length: 8 }, (__, studentIndex) => `QA-2026-${String(index * 8 + studentIndex + 1).padStart(3, '0')}`),
      status: 'active',
    };
  });
  const teachers = classRows.map((classRow, index) => {
    const suffix = ['bad', 'koo', 'hib', 'jun'][index];
    return {
      teacherId: classRow.teacherId,
      username: classRow.teacherId,
      email: `qa-teacher-${index + 1}@globyedu.test`,
      fullName: `QA Teacher ${String(index + 1).padStart(2, '0')}`,
      role: 'teacher',
      assignedClasses: [classRow.classId],
      assignedSubjects: ['Mathematics', 'English'],
      className: classRow.name,
      status: 'active',
      emailVerified: true,
    };
  });
  const students = classRows.flatMap((classRow, classIndex) => classRow.students.map((studentId, index) => ({
    studentId,
    username: studentId,
    email: `${studentId.toLowerCase()}@globyedu.test`,
    fullName: `QA Student ${String(classIndex * 8 + index + 1).padStart(2, '0')}`,
    role: 'student',
    classId: classRow.classId,
    className: classRow.name,
    grade: classRow.grade,
    status: 'active',
    emailVerified: true,
  })));
  const platformAdmin = {
    username: 'qa-admin@globyedu.test',
    email: 'qa-admin@globyedu.test',
    fullName: 'QA Platform Admin',
    role: 'super_admin',
    platformAdmin: true,
    status: 'active',
    emailVerified: true,
    passwordHash,
    passwordNeedsReset: false,
  };
  const authority = {
    username: 'qa-authority@globyedu.test',
    email: 'qa-authority@globyedu.test',
    fullName: 'QA School Authority',
    role: 'school_authority',
    platformAdmin: false,
    status: 'active',
    emailVerified: true,
    passwordHash,
    passwordNeedsReset: false,
  };
  const teacherUsers = teachers.map((teacher) => ({
    ...teacher,
    passwordHash,
    passwordNeedsReset: false,
    platformAdmin: false,
  }));
  const studentUsers = students.map((student) => ({
    ...student,
    studentPasswordHash: passwordHash,
    passwordNeedsReset: false,
    platformAdmin: false,
  }));
  const assignments = classRows.map((classRow, index) => ({
    id: `QA-ASSIGNMENT-${classRow.classId}`,
    title: `QA Baseline Assignment ${index + 1}`,
    description: 'Seeded QA assignment for visibility and submission testing.',
    subject: 'Mathematics',
    classId: classRow.classId,
    className: classRow.name,
    teacherId: classRow.teacherId,
    teacher: `QA Teacher ${String(index + 1).padStart(2, '0')}`,
    dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'assigned',
    submissions: [],
  }));
  const school = {
    id: schoolId,
    schoolId,
    name: schoolName,
    email: 'qa-authority@globyedu.test',
    headName: authority.fullName,
    headEmail: authority.email,
    description: 'Synthetic data for isolated local QA. Not a real school.',
    developmentOnly: true,
    subscriptionPlan: 'QA Trial',
    subscriptionStatus: 'trial',
    schoolStatus: 'active',
    status: 'active',
    trialEndsAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
    classes: classRows,
    teachers,
    students,
    users: [platformAdmin, authority, ...teacherUsers, ...studentUsers],
    assignments,
    lessons: [],
    attendanceRecords: [],
    examRecords: [],
    examResults: [],
    reportCards: [],
    announcements: [],
    messages: [],
    supportTickets: [],
    auditLogs: [],
  };
  const otherSchool = {
    id: secondarySchoolId,
    schoolId: secondarySchoolId,
    name: 'Globy Isolated QA Other Tenant',
    description: 'Synthetic second tenant for non-destructive isolation checks.',
    developmentOnly: true,
    subscriptionPlan: 'QA Trial',
    subscriptionStatus: 'trial',
    schoolStatus: 'active',
    status: 'active',
    users: [],
    teachers: [],
    students: [],
    classes: [],
    assignments: [],
    attendanceRecords: [],
  };

  fs.mkdirSync(qaHome, { recursive: false });
  try {
    writeNewFile(path.join(qaHome, 'schools.json'), `${JSON.stringify({ schools: [school, otherSchool] }, null, 2)}\n`);
    writeNewFile(path.join(qaHome, 'audit-logs.json'), `${JSON.stringify({ logs: [] }, null, 2)}\n`);
    writeNewFile(path.join(qaHome, 'password-reset-tokens.json'), `${JSON.stringify({ tokens: [] }, null, 2)}\n`);
    const credentialRows = [
      'GlobyEdu isolated local QA accounts',
      `QA school: ${schoolName}`,
      `School ID: ${schoolId}`,
      `Platform Admin: ${platformAdmin.username}`,
      `School Authority: ${authority.username}`,
      ...teachers.map((teacher) => `Teacher: ${teacher.teacherId} (${teacher.email}) -> ${teacher.className}`),
      'Students: QA-2026-001 through QA-2026-032 (eight students per class)',
      `Shared QA-only password: ${password}`,
      '',
      'Keep this file private. It is not a production credential. Do not commit or share it.',
    ];
    writeNewFile(path.join(qaHome, 'accounts.txt'), `${credentialRows.join('\n')}\n`);
  } catch (error) {
    throw new Error(`QA setup was only partially written; preserve and inspect ${qaHome} before retrying. ${error.message}`);
  }

  console.log(`Created isolated QA files under ${qaHome}`);
  console.log('Seeded two synthetic tenants, one platform admin, one authority, four teachers, 32 students, four classes, and four assignments.');
  console.log(`Credentials are stored privately at ${path.join(qaHome, 'accounts.txt')}.`);
}

provision().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
