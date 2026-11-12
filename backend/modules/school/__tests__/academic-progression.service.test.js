jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../firebase.core', () => ({ isFirebaseCoreMode: () => false }));

const cleanupIsolatedSchoolStore = require('./isolated-school-store')();
const { loadSchoolData, saveSchoolData } = require('../fallback.school');
const progressionService = require('../academic-progression.service');

const SCHOOL_ID = 'progression-qa-school';
const OTHER_SCHOOL_ID = 'progression-other-school';
const authority = {
  userId: `${SCHOOL_ID}:AUTH-1`,
  username: 'AUTH-1',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
  schoolId: SCHOOL_ID,
};

let sourceYear;
let targetYear;
let sourceClass;
let targetClass;
let repeaterClass;

async function createStudent(studentId, classRecord = sourceClass, year = sourceYear, extra = {}) {
  const student = {
    studentId,
    fullName: `Student ${studentId}`,
    email: `${studentId.toLowerCase()}@progression.test`,
    role: 'student',
    classId: classRecord.classId,
    className: classRecord.name,
    grade: classRecord.grade,
    gradeLevel: classRecord.grade,
    academicYearId: year.id,
    currentAcademicYear: year.id,
    status: 'active',
    metadata: { classId: classRecord.classId, academicYearId: year.id },
    ...extra,
  };
  const schools = loadSchoolData();
  const school = schools.find((entry) => entry.schoolId === SCHOOL_ID);
  school.students.push(student);
  school.users.push({ ...student, username: studentId, role: 'student' });
  saveSchoolData(schools);
  return student;
}

async function runProgression(decisions, operationId = 'progression-op-0001') {
  return progressionService.confirmProgression(SCHOOL_ID, {
    fromAcademicYearId: sourceYear.id,
    targetAcademicYearId: targetYear.id,
    decisions,
    operationId,
    confirmed: true,
  }, authority);
}

beforeEach(async () => {
  sourceYear = { id: 'year-source', label: '2025/2026', status: 'archived' };
  targetYear = { id: 'year-target', label: '2026/2027', status: 'active' };
  sourceClass = { id: 'class-source', classId: 'class-source', name: 'JHS 1 Blue', grade: 'JHS 1', section: 'Blue', academicYearId: sourceYear.id, studentIds: [] };
  targetClass = { id: 'class-target', classId: 'class-target', name: 'Basic 8 Blue', grade: 'Basic 8', section: 'Blue', academicYearId: targetYear.id, studentIds: [] };
  repeaterClass = { id: 'class-repeater', classId: 'class-repeater', name: 'JHS 1 Blue', grade: 'JHS 1', section: 'Blue', academicYearId: targetYear.id, studentIds: [] };
  const school = {
    id: SCHOOL_ID,
    schoolId: SCHOOL_ID,
    name: 'Progression QA School',
    academicYears: [sourceYear, targetYear],
    classes: [sourceClass, targetClass, repeaterClass],
    students: [],
    teachers: [],
    users: [],
    enrollments: [],
    attendanceRecords: [],
    examResults: [],
    examRecords: [],
    reportCards: [],
  };
  school.academicStructure = {
    classAliases: { 'JHS 1': ['Basic 7'], 'JHS 2': ['Basic 8'], 'JHS 3': ['Basic 9'] },
    progressionPaths: { JHS: ['JHS 1', 'JHS 2', 'JHS 3'] },
    graduationClasses: ['SHS 3'],
  };
  saveSchoolData([school, {
    id: OTHER_SCHOOL_ID,
    schoolId: OTHER_SCHOOL_ID,
    name: 'Progression Other School',
    academicYears: [],
    classes: [],
    students: [],
    teachers: [],
    users: [],
  }]);
});

afterEach(() => {
  const schools = loadSchoolData();
  schools.splice(0, schools.length);
  saveSchoolData(schools);
});

afterAll(() => cleanupIsolatedSchoolStore());

describe('academic progression workflow', () => {
  test('previews and promotes students using configured class aliases while preserving history and identity', async () => {
    const student = await createStudent('STD-PROMOTE-1');
    const schools = loadSchoolData();
    const school = schools.find((entry) => entry.schoolId === SCHOOL_ID);
    school.attendanceRecords = [{ studentId: student.studentId, classId: sourceClass.classId, date: '2026-06-01', status: 'present' }];
    school.examResults = [{ studentId: student.studentId, classId: sourceClass.classId, academicYearId: sourceYear.id, score: 90 }];
    school.enrollments.push({
      id: 'source-enrollment',
      studentId: student.studentId,
      academicYearId: sourceYear.id,
      classId: sourceClass.classId,
      status: 'active',
      isCurrent: true,
    });
    saveSchoolData(schools);

    const preview = await progressionService.previewProgression(SCHOOL_ID, {
      fromAcademicYearId: sourceYear.id,
      targetAcademicYearId: targetYear.id,
    }, authority);
    expect(preview.students).toEqual([expect.objectContaining({
      studentId: student.studentId,
      action: 'promote',
      targetClassId: targetClass.classId,
    })]);
    await runProgression([{ studentId: student.studentId, action: 'promote' }]);

    const updatedSchool = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID);
    const updatedStudent = updatedSchool.students.find((entry) => entry.studentId === student.studentId);
    expect(updatedStudent).toMatchObject({
      studentId: student.studentId,
      classId: targetClass.classId,
      className: targetClass.name,
      academicYearId: targetYear.id,
    });
    expect(updatedStudent.metadata.classHistory).toContainEqual(expect.objectContaining({
      classId: sourceClass.classId,
      academicYearId: sourceYear.id,
    }));
    expect(updatedSchool.attendanceRecords).toHaveLength(1);
    expect(updatedSchool.examResults).toHaveLength(1);
    expect(updatedSchool.enrollments).toContainEqual(expect.objectContaining({
      studentId: student.studentId,
      classId: targetClass.classId,
      academicYearId: targetYear.id,
      isCurrent: true,
    }));
    expect(updatedSchool.enrollments).toContainEqual(expect.objectContaining({
      id: 'source-enrollment',
      status: 'completed',
      isCurrent: false,
    }));
  });

  test('repeats a student in the equivalent class for the new year', async () => {
    const student = await createStudent('STD-REPEAT-1');
    await runProgression([{ studentId: student.studentId, action: 'repeat' }]);
    const updated = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID).students[0];
    expect(updated.classId).toBe(repeaterClass.classId);
    expect(updated.className).toBe(repeaterClass.name);
  });

  test('supports manual placement in a tenant-owned class for the target year', async () => {
    const student = await createStudent('STD-MANUAL-1');
    const manualClass = { id: 'class-manual', classId: 'class-manual', name: 'JHS 2 Green', grade: 'JHS 2', section: 'Green', academicYearId: targetYear.id, studentIds: [] };
    const schools = loadSchoolData();
    const school = schools.find((entry) => entry.schoolId === SCHOOL_ID);
    school.classes.push(manualClass);
    saveSchoolData(schools);
    await runProgression([{ studentId: student.studentId, action: 'manual', targetClassId: manualClass.classId }]);
    const updated = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID).students[0];
    expect(updated.classId).toBe(manualClass.classId);
    expect(updated.metadata.progressionHistory[0].action).toBe('manual');
  });

  test('supports configured Primary-to-JHS and JHS-to-SHS transitions', async () => {
    const primarySource = { id: 'class-primary-6', classId: 'class-primary-6', name: 'Primary 6', grade: 'Primary 6', academicYearId: sourceYear.id, studentIds: [] };
    const jhsTarget = { id: 'class-jhs-1', classId: 'class-jhs-1', name: 'JHS 1', grade: 'Basic 7', academicYearId: targetYear.id, studentIds: [] };
    const jhs3Source = { id: 'class-jhs-3', classId: 'class-jhs-3', name: 'JHS 3', grade: 'JHS 3', academicYearId: sourceYear.id, studentIds: [] };
    const shsTarget = { id: 'class-shs-1', classId: 'class-shs-1', name: 'SHS 1', grade: 'SHS 1', academicYearId: targetYear.id, studentIds: [] };
    const schools = loadSchoolData();
    const school = schools.find((entry) => entry.schoolId === SCHOOL_ID);
    school.classes.push(primarySource, jhsTarget, jhs3Source, shsTarget);
    school.academicStructure.progression = { 'Primary 6': 'JHS 1', 'JHS 3': 'SHS 1' };
    saveSchoolData(schools);
    const primary = await createStudent('STD-PRIMARY-1', primarySource);
    const jhs = await createStudent('STD-JHS-3-1', jhs3Source);

    const preview = await progressionService.previewProgression(SCHOOL_ID, {
      fromAcademicYearId: sourceYear.id,
      targetAcademicYearId: targetYear.id,
    }, authority);
    expect(preview.students).toEqual(expect.arrayContaining([
      expect.objectContaining({ studentId: primary.studentId, action: 'promote', targetClassId: jhsTarget.classId }),
      expect.objectContaining({ studentId: jhs.studentId, action: 'promote', targetClassId: shsTarget.classId }),
    ]));
  });

  test('graduates only from a configured final class and retains the student identity', async () => {
    const finalClass = { id: 'class-final', classId: 'class-final', name: 'SHS 3', grade: 'SHS 3', academicYearId: sourceYear.id, studentIds: [] };
    const schools = loadSchoolData();
    const school = schools.find((entry) => entry.schoolId === SCHOOL_ID);
    school.classes.push(finalClass);
    saveSchoolData(schools);
    const student = await createStudent('STD-GRAD-1', finalClass);
    await runProgression([{ studentId: student.studentId, action: 'graduated' }]);
    const updated = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID).students.find((entry) => entry.studentId === student.studentId);
    expect(updated).toMatchObject({ studentId: student.studentId, status: 'graduated', classId: null });
    expect(updated.metadata.classHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ classId: finalClass.classId, academicYearId: sourceYear.id }),
    ]));
  });

  test.each(['transferred', 'withdrawn'])('preserves student and class history on %s', async (action) => {
    const student = await createStudent(`STD-${action.toUpperCase()}-1`);
    const details = action === 'transferred' ? { transferDestination: 'Other School' } : { note: 'Family relocation' };
    await runProgression([{ studentId: student.studentId, action, ...details }], `progression-${action}-0001`);
    const updated = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID).students.find((entry) => entry.studentId === student.studentId);
    expect(updated).toMatchObject({ studentId: student.studentId, status: action, classId: null });
    expect(updated.metadata.progressionHistory[0]).toMatchObject({ action, ...details });
  });

  test('is idempotent for operation retries and prevents duplicate target enrollments', async () => {
    const student = await createStudent('STD-IDEMPOTENT-1');
    const decisions = [{ studentId: student.studentId, action: 'promote' }];
    await runProgression(decisions, 'progression-idempotent-1');
    const retry = await runProgression(decisions, 'progression-idempotent-1');
    expect(retry.results).toEqual([{ studentId: student.studentId, action: 'promote', idempotent: true }]);
    const school = loadSchoolData().find((entry) => entry.schoolId === SCHOOL_ID);
    expect(school.enrollments.filter((entry) => entry.studentId === student.studentId && entry.academicYearId === targetYear.id)).toHaveLength(1);
    await expect(runProgression(decisions, 'progression-idempotent-2')).rejects.toThrow('outside the preview');
  });

  test('rejects a second active enrollment in the target academic year', async () => {
    const student = await createStudent('STD-DUPLICATE-1');
    const schools = loadSchoolData();
    const school = schools.find((entry) => entry.schoolId === SCHOOL_ID);
    school.enrollments.push({
      id: 'existing-target-enrollment',
      studentId: student.studentId,
      academicYearId: targetYear.id,
      classId: repeaterClass.classId,
      status: 'active',
      isCurrent: true,
    });
    saveSchoolData(schools);
    await expect(runProgression([{ studentId: student.studentId, action: 'promote' }], 'progression-duplicate-1'))
      .rejects.toThrow('current enrollment already exists');
  });

  test('blocks non-authority access and cross-tenant scope', async () => {
    const student = await createStudent('STD-TENANT-1');
    await expect(progressionService.previewProgression(SCHOOL_ID, {
      fromAcademicYearId: sourceYear.id,
      targetAcademicYearId: targetYear.id,
    }, { ...authority, roles: ['teacher'] })).rejects.toThrow('Only School Authority');
    await expect(progressionService.previewProgression(SCHOOL_ID, {
      fromAcademicYearId: sourceYear.id,
      targetAcademicYearId: targetYear.id,
    }, { ...authority, schoolId: OTHER_SCHOOL_ID, tenantId: OTHER_SCHOOL_ID })).rejects.toThrow('Tenant mismatch');
    const schools = loadSchoolData();
    const otherSchool = schools.find((entry) => entry.schoolId === OTHER_SCHOOL_ID);
    otherSchool.academicYears = [sourceYear, targetYear];
    otherSchool.classes.push({
      classId: 'foreign-target-class',
      name: 'Foreign JHS 2',
      grade: 'JHS 2',
      academicYearId: targetYear.id,
    });
    saveSchoolData(schools);
    await expect(runProgression([{
      studentId: student.studentId,
      action: 'manual',
      targetClassId: 'foreign-target-class',
    }], 'progression-cross-tenant')).rejects.toThrow('not in the target academic year');
  });

  test('rejects a target class from another academic year and refuses unconfigured graduation', async () => {
    const student = await createStudent('STD-INVALID-1');
    await expect(runProgression([{ studentId: student.studentId, action: 'manual', targetClassId: sourceClass.classId }]))
      .rejects.toThrow('not in the target academic year');
    await expect(runProgression([{ studentId: student.studentId, action: 'graduated' }], 'progression-invalid-grad'))
      .rejects.toThrow('Graduation is not configured');
  });

  test('rejects an archived target academic year', async () => {
    const schools = loadSchoolData();
    schools.find((entry) => entry.schoolId === SCHOOL_ID).academicYears
      .find((year) => year.id === targetYear.id).status = 'archived';
    saveSchoolData(schools);
    await expect(progressionService.previewProgression(SCHOOL_ID, {
      fromAcademicYearId: sourceYear.id,
      targetAcademicYearId: targetYear.id,
    }, authority)).rejects.toThrow('target academic year is archived');
  });
});
