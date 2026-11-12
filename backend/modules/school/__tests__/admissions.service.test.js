jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../firebase.core', () => ({ isFirebaseCoreMode: () => false }));

const cleanupIsolatedSchoolStore = require('./isolated-school-store')();
const { loadSchoolData } = require('../fallback.school');
const schoolService = require('../school.service');
const admissionsService = require('../admissions.service');

const SCHOOL_ID = 'admissions-qa-school';
const OTHER_SCHOOL_ID = 'admissions-other-school';
const authority = {
  userId: `${SCHOOL_ID}:AUTH-1`,
  username: 'AUTH-1',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
  schoolId: SCHOOL_ID,
};
const teacher = {
  userId: `${SCHOOL_ID}:T-1`,
  username: 'T-1',
  roles: ['teacher'],
  tenantId: SCHOOL_ID,
  schoolId: SCHOOL_ID,
};

let classRecord;
let academicYear;

beforeEach(async () => {
  await schoolService.createSchool({ schoolId: SCHOOL_ID, name: 'Admissions QA School' });
  await schoolService.createSchool({ schoolId: OTHER_SCHOOL_ID, name: 'Other Admissions School' });
  academicYear = await schoolService.createEntity(SCHOOL_ID, 'academicYears', {
    label: '2026/2027',
    status: 'active',
    startDate: '2026-09-01',
    endDate: '2027-07-01',
  }, authority);
  const createdTeacher = await schoolService.createEntity(SCHOOL_ID, 'teachers', {
    teacherId: 'T-1',
    fullName: 'Assigned Teacher',
    email: 'teacher@admissions.test',
  }, authority);
  classRecord = await schoolService.createEntity(SCHOOL_ID, 'classes', {
    name: 'JHS 1 Blue',
    grade: 'JHS 1',
    academicYearId: academicYear.id,
    teacherIds: [createdTeacher.teacherId],
  }, authority);
});

afterEach(() => {
  const schools = loadSchoolData();
  schools.splice(0, schools.length);
  require('../fallback.school').saveSchoolData(schools);
});

afterAll(() => cleanupIsolatedSchoolStore());

function applicationPayload(overrides = {}) {
  return {
    fullName: 'Ama Mensah',
    email: 'ama.mensah@example.test',
    guardian: 'Kwame Mensah',
    parentPhone: '+233200000000',
    parentEmail: 'guardian@example.test',
    preferredClassId: classRecord.classId,
    preferredAcademicYearId: academicYear.id,
    ...overrides,
  };
}

describe('admission application and enrollment workflow', () => {
  test('creates and updates pending admission records without adding pending applicants to the student roster', async () => {
    const admission = await admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), authority);
    expect(admission).toMatchObject({
      applicationNumber: expect.stringMatching(/^ADM-\d{4}-[A-F0-9]{6}$/),
      status: 'pending',
      studentId: null,
      fullName: 'Ama Mensah',
    });
    expect((await schoolService.getEntities(SCHOOL_ID, 'students', {}, authority)).total).toBe(0);

    const updated = await admissionsService.updateAdmission(SCHOOL_ID, admission.applicationId, {
      guardian: 'Updated Guardian',
      profilePhotoPath: 'student-profile/admission-photo.png',
    }, authority);
    expect(updated).toMatchObject({
      guardian: 'Updated Guardian',
      profilePhotoPath: 'student-profile/admission-photo.png',
    });
    expect(updated.history).toHaveLength(2);
  });

  test('approval creates one student, assigns class/year, and makes the roster visible to assigned teachers', async () => {
    const admission = await admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), authority);
    const result = await admissionsService.decideAdmission(SCHOOL_ID, admission.applicationId, {
      decision: 'approved',
      classId: classRecord.classId,
      academicYearId: academicYear.id,
    }, authority);

    expect(result.admission).toMatchObject({
      status: 'approved',
      classId: classRecord.classId,
      academicYearId: academicYear.id,
      studentId: expect.stringMatching(/^STD-/),
    });
    expect(result.student).toMatchObject({
      studentId: result.admission.studentId,
      classId: classRecord.classId,
      className: 'JHS 1 Blue',
      admissionNumber: admission.applicationNumber,
      metadata: { admissionApplicationId: admission.applicationId },
    });
    const authorityRoster = await schoolService.getEntities(SCHOOL_ID, 'students', {}, authority);
    const teacherRoster = await schoolService.getEntities(SCHOOL_ID, 'students', {}, teacher);
    expect(authorityRoster.items).toHaveLength(1);
    expect(teacherRoster.items).toEqual([expect.objectContaining({ studentId: result.student.studentId })]);

    const retry = await admissionsService.decideAdmission(SCHOOL_ID, admission.applicationId, {
      decision: 'approved',
    }, authority);
    expect(retry.idempotent).toBe(true);
    expect((await schoolService.getEntities(SCHOOL_ID, 'students', {}, authority)).items).toHaveLength(1);
    expect(loadSchoolData().find((school) => school.schoolId === SCHOOL_ID).enrollments).toHaveLength(1);
  });

  test('rejects duplicate applications and does not enroll rejected applicants', async () => {
    const admission = await admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), authority);
    await expect(admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), authority))
      .rejects.toThrow('active admission application already exists');
    const rejected = await admissionsService.decideAdmission(SCHOOL_ID, admission.applicationId, {
      decision: 'rejected',
      note: 'Incomplete records',
    }, authority);
    expect(rejected.admission.status).toBe('rejected');
    expect((await schoolService.getEntities(SCHOOL_ID, 'students', {}, authority)).total).toBe(0);
    expect(loadSchoolData().find((school) => school.schoolId === SCHOOL_ID).enrollments).toHaveLength(0);
  });

  test('rejects invalid tenant, unauthorized roles, and cross-tenant class/year identifiers', async () => {
    await expect(admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), teacher))
      .rejects.toThrow('Only School Authority');
    await expect(admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), {
      ...authority,
      tenantId: OTHER_SCHOOL_ID,
    })).rejects.toThrow('Tenant mismatch');

    const admission = await admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), authority);
    await expect(admissionsService.decideAdmission(SCHOOL_ID, admission.applicationId, {
      decision: 'approved',
      classId: 'other-school-class',
      academicYearId: academicYear.id,
    }, authority)).rejects.toThrow('Class does not belong to this school');
    await expect(admissionsService.getAdmission(OTHER_SCHOOL_ID, admission.applicationId, {
      ...authority,
      tenantId: OTHER_SCHOOL_ID,
      schoolId: OTHER_SCHOOL_ID,
    })).rejects.toThrow('Admission application not found');
  });

  test('requires valid placement and links a matching existing student instead of duplicating the roster', async () => {
    const admission = await admissionsService.createAdmission(SCHOOL_ID, applicationPayload(), authority);
    await expect(admissionsService.decideAdmission(SCHOOL_ID, admission.applicationId, {
      decision: 'approved',
      classId: classRecord.classId,
      academicYearId: 'missing-year',
    }, authority)).rejects.toThrow('Academic year does not belong to this school');
    const existing = await schoolService.createEntity(SCHOOL_ID, 'students', {
      studentId: 'STD-EXISTING-1',
      fullName: 'Ama Mensah',
      email: 'ama.mensah@example.test',
      classId: classRecord.classId,
      className: classRecord.name,
    }, authority);
    const result = await admissionsService.decideAdmission(SCHOOL_ID, admission.applicationId, {
      decision: 'approved',
      classId: classRecord.classId,
      academicYearId: academicYear.id,
    }, authority);
    expect(result.student.studentId).toBe(existing.studentId);
    expect(result.admission.studentId).toBe(existing.studentId);
    expect((await schoolService.getEntities(SCHOOL_ID, 'students', {}, authority)).items).toHaveLength(1);
  });
});
