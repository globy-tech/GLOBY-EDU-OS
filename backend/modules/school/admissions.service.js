const crypto = require('crypto');
const prisma = require('../../config/prisma.client');
const firebaseCore = require('../../firebase.core');
const {
  loadSchoolData,
  saveSchoolData,
  findSchoolBySchoolId,
  ensureSchoolEntities,
  createStudentIdentifier,
} = require('./fallback.school');
const schoolService = require('./school.service');

const EDITABLE_FIELDS = [
  'fullName',
  'email',
  'phone',
  'gender',
  'dateOfBirth',
  'address',
  'guardian',
  'parentPhone',
  'parentEmail',
  'gradeLevel',
  'documents',
  'profilePhotoPath',
  'preferredClassId',
  'preferredAcademicYearId',
];

function actorRoles(actor = {}) {
  const roles = Array.isArray(actor.roles) ? actor.roles : [actor.role].filter(Boolean);
  return new Set(roles.map((role) => String(typeof role === 'string' ? role : role?.name || role?.role?.name || '').toLowerCase()));
}

function assertAuthority(actor, schoolId) {
  const roles = actorRoles(actor);
  if (roles.has('super_admin') && actor.platformAdmin === true) return;
  if (!roles.has('school_authority') && !roles.has('school_head')) {
    throw new Error('Only School Authority can manage admission applications.');
  }
  if (String(actor.tenantId || actor.schoolId || '') !== String(schoolId)) {
    throw new Error('Tenant mismatch');
  }
}

function assertTenantScope(actor, schoolId) {
  const roles = actorRoles(actor);
  if (roles.has('super_admin') && actor.platformAdmin === true) return;
  if (String(actor.tenantId || actor.schoolId || '') !== String(schoolId)) {
    throw new Error('Tenant mismatch');
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStudentData(payload = {}) {
  const result = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.hasOwn(payload, field)) result[field] = payload[field];
  }
  result.fullName = String(result.fullName || '').trim();
  result.email = normalizeEmail(result.email);
  result.documents = Array.isArray(result.documents)
    ? result.documents.slice(0, 50).map((entry) => String(entry).slice(0, 500))
    : [];
  for (const field of ['phone', 'gender', 'dateOfBirth', 'address', 'guardian', 'parentPhone', 'parentEmail', 'gradeLevel', 'profilePhotoPath', 'preferredClassId', 'preferredAcademicYearId']) {
    if (result[field] !== undefined && result[field] !== null) result[field] = String(result[field]).trim();
  }
  if (!result.fullName || !result.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
    throw new Error('A student name and valid email address are required.');
  }
  return result;
}

function normalizeAdmission(record = {}) {
  const studentData = record.studentData && typeof record.studentData === 'object'
    ? record.studentData
    : {};
  return {
    ...record,
    ...studentData,
    id: record.applicationId || String(record.id || '').split(':').pop(),
    applicationId: record.applicationId || String(record.id || '').split(':').pop(),
    studentData,
    history: Array.isArray(record.history) ? record.history : [],
  };
}

function makeHistory(status, actor, note = '') {
  return {
    status,
    changedAt: new Date().toISOString(),
    changedBy: String(actor.userId || actor.username || actor.email || ''),
    note: String(note || '').trim().slice(0, 500),
  };
}

async function getTenantId(schoolId) {
  const tenant = await prisma.tenant.findUnique({ where: { schoolId }, select: { id: true } });
  if (!tenant) throw new Error('School not found');
  return tenant.id;
}

async function loadAdmissions(schoolId, status = '') {
  let records;
  if (firebaseCore.isFirebaseCoreMode()) {
    records = await firebaseCore.listBySchool('admissions', schoolId);
  } else if (prisma && !prisma.__stub) {
    const tenantId = await getTenantId(schoolId);
    records = await prisma.admissionApplication.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  } else {
    const school = findSchoolBySchoolId(loadSchoolData(), schoolId);
    if (!school) throw new Error('School not found');
    ensureSchoolEntities(school);
    records = school.admissions;
  }
  const filtered = records.map(normalizeAdmission)
    .filter((record) => !status || record.status === status);
  return filtered.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}

async function getAdmissions(schoolId, actor, options = {}) {
  assertAuthority(actor, schoolId);
  return loadAdmissions(schoolId, options.status || '');
}

async function findAdmission(schoolId, admissionId) {
  if (firebaseCore.isFirebaseCoreMode()) {
    const record = await firebaseCore.getById('admissions', `${schoolId}:${admissionId}`);
    return record && record.schoolId === schoolId ? normalizeAdmission(record) : null;
  }
  if (prisma && !prisma.__stub) {
    const tenantId = await getTenantId(schoolId);
    const record = await prisma.admissionApplication.findFirst({ where: { id: admissionId, tenantId } });
    return record ? normalizeAdmission(record) : null;
  }
  const school = findSchoolBySchoolId(loadSchoolData(), schoolId);
  return school?.admissions?.map(normalizeAdmission).find((record) => String(record.id) === String(admissionId)) || null;
}

async function getAdmission(schoolId, admissionId, actor) {
  assertAuthority(actor, schoolId);
  const record = await findAdmission(schoolId, admissionId);
  if (!record) throw new Error('Admission application not found');
  return record;
}

async function persistAdmission(schoolId, admission, studentData, history) {
  const updated = {
    ...admission,
    studentData: studentData || admission.studentData,
    history: history || admission.history,
    updatedAt: new Date().toISOString(),
  };
  if (firebaseCore.isFirebaseCoreMode()) {
    await firebaseCore.saveById('admissions', `${schoolId}:${admission.id}`, {
      ...updated,
      schoolId,
    }, true);
    return normalizeAdmission(updated);
  }
  if (prisma && !prisma.__stub) {
    const tenantId = await getTenantId(schoolId);
    const result = await prisma.admissionApplication.updateMany({
      where: { id: admission.id, tenantId },
      data: {
        studentData: updated.studentData,
        history: updated.history,
        status: updated.status,
        applicationNumber: updated.applicationNumber,
        studentId: updated.studentId || null,
        classId: updated.classId || null,
        academicYearId: updated.academicYearId || null,
        reviewedBy: updated.reviewedBy || null,
      },
    });
    if (result.count !== 1) throw new Error('Admission application changed or no longer exists.');
    return normalizeAdmission(updated);
  }
  const schools = loadSchoolData();
  const school = findSchoolBySchoolId(schools, schoolId);
  if (!school) throw new Error('School not found');
  ensureSchoolEntities(school);
  const index = school.admissions.findIndex((entry) => String(entry.id) === String(admission.id));
  if (index < 0) throw new Error('Admission application not found');
  school.admissions[index] = updated;
  saveSchoolData(schools);
  return normalizeAdmission(updated);
}

async function createAdmission(schoolId, payload, actor) {
  assertAuthority(actor, schoolId);
  const studentData = normalizeStudentData(payload);
  const existing = await getAdmissions(schoolId, actor);
  if (existing.some((entry) => entry.email === studentData.email && ['pending', 'approved', 'enrolling'].includes(entry.status))) {
    throw new Error('An active admission application already exists for this email.');
  }
  const now = new Date().toISOString();
  const year = new Date(now).getUTCFullYear();
  const admission = {
    id: crypto.randomUUID(),
    applicationNumber: `ADM-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    schoolId,
    studentData,
    status: 'pending',
    studentId: null,
    classId: null,
    academicYearId: null,
    submittedBy: String(actor.userId || actor.username || actor.email || ''),
    history: [makeHistory('pending', actor)],
    createdAt: now,
    updatedAt: now,
  };
  if (firebaseCore.isFirebaseCoreMode()) {
    await firebaseCore.createById('admissions', `${schoolId}:${admission.id}`, admission);
    return normalizeAdmission(admission);
  }
  if (prisma && !prisma.__stub) {
    const tenantId = await getTenantId(schoolId);
    const created = await prisma.admissionApplication.create({
      data: {
        id: admission.id,
        tenantId,
        applicationNumber: admission.applicationNumber,
        status: admission.status,
        studentData,
        history: admission.history,
        submittedBy: admission.submittedBy,
      },
    });
    return normalizeAdmission(created);
  }
  const schools = loadSchoolData();
  const school = findSchoolBySchoolId(schools, schoolId);
  if (!school) throw new Error('School not found');
  ensureSchoolEntities(school);
  school.admissions.push(admission);
  saveSchoolData(schools);
  return normalizeAdmission(admission);
}

async function updateAdmission(schoolId, admissionId, payload, actor) {
  assertAuthority(actor, schoolId);
  const admission = await findAdmission(schoolId, admissionId);
  if (!admission) throw new Error('Admission application not found');
  if (admission.status !== 'pending') throw new Error('Only pending applications can be edited.');
  const studentData = normalizeStudentData({ ...admission.studentData, ...payload });
  const duplicate = (await getAdmissions(schoolId, actor)).find((entry) =>
    entry.id !== admission.id && entry.email === studentData.email && ['pending', 'approved', 'enrolling'].includes(entry.status)
  );
  if (duplicate) throw new Error('Another active admission application already uses this email.');
  return persistAdmission(schoolId, admission, studentData, [
    ...admission.history,
    makeHistory('pending', actor, 'Application details updated'),
  ]);
}

function findSchoolRecord(records, id, fields) {
  return (Array.isArray(records) ? records : []).find((record) =>
    fields.some((field) => String(record[field] || '') === String(id || ''))
  );
}

async function validatePlacement(schoolId, admission, placement) {
  const school = await schoolService.getSchoolBySchoolId(schoolId);
  if (!school) throw new Error('School not found');
  const classId = String(placement.classId || admission.studentData.preferredClassId || '').trim();
  const academicYearId = String(placement.academicYearId || admission.studentData.preferredAcademicYearId || '').trim();
  if (!classId || !academicYearId) throw new Error('A class and academic year are required for enrollment.');
  const classRecord = findSchoolRecord(school.classes, classId, ['classId', 'id']);
  if (!classRecord || String(classRecord.status || 'active').toLowerCase() === 'archived') {
    throw new Error('Class does not belong to this school or is not active.');
  }
  const yearRecord = findSchoolRecord(school.academicYears, academicYearId, ['id', 'academicYearId']);
  if (!yearRecord || String(yearRecord.status || 'active').toLowerCase() === 'archived') {
    throw new Error('Academic year does not belong to this school or is not active.');
  }
  const classYearId = String(classRecord.academicYearId || '').trim();
  if (classYearId && classYearId !== academicYearId) {
    throw new Error('The selected class belongs to a different academic year.');
  }
  return { school, classRecord, yearRecord, classId, academicYearId };
}

async function persistEnrollment(schoolId, school, student, placement, admissionId) {
  if (firebaseCore.isFirebaseCoreMode()) {
    const activeEnrollments = Array.isArray(school.enrollments) ? school.enrollments : [];
    for (const current of activeEnrollments) {
      if (String(current.studentId) === String(student.studentId)
        && current.isCurrent === true
        && !(String(current.classId) === String(placement.classId)
          && String(current.academicYearId) === String(placement.academicYearId))) {
        await firebaseCore.saveById('enrollments', current.id, {
          isCurrent: false,
          status: 'completed',
        }, true);
      }
    }
    const enrollmentId = `${schoolId}:${student.studentId}:${placement.academicYearId}:${placement.classId}`;
    return firebaseCore.saveById('enrollments', enrollmentId, {
      id: enrollmentId,
      schoolId,
      studentId: student.studentId,
      classId: placement.classId,
      academicYearId: placement.academicYearId,
      admissionId,
      status: 'active',
      isCurrent: true,
    }, true);
  }
  if (prisma && !prisma.__stub) {
    const tenantId = await getTenantId(schoolId);
    const user = await prisma.user.findFirst({
      where: { tenantId, studentId: student.studentId },
      select: { id: true },
    });
    if (!user) throw new Error('The student account was not persisted; enrollment was not recorded.');
    await prisma.enrollment.updateMany({
      where: {
        userId: user.id,
        isCurrent: true,
        NOT: {
          classId: placement.classId,
          academicYearId: placement.academicYearId,
        },
      },
      data: { status: 'completed', isCurrent: false },
    });
    return prisma.enrollment.upsert({
      where: {
        userId_academicYearId_classId: {
          userId: user.id,
          academicYearId: placement.academicYearId,
          classId: placement.classId,
        },
      },
      create: {
        userId: user.id,
        academicYearId: placement.academicYearId,
        classId: placement.classId,
        status: 'active',
        isCurrent: true,
      },
      update: { status: 'active', isCurrent: true },
    });
  }
  const schools = loadSchoolData();
  const currentSchool = findSchoolBySchoolId(schools, schoolId);
  if (!currentSchool) throw new Error('School not found');
  if (!Array.isArray(currentSchool.enrollments)) currentSchool.enrollments = [];
  currentSchool.enrollments.forEach((entry) => {
    if (String(entry.studentId) === String(student.studentId)
      && entry.isCurrent === true
      && !(String(entry.classId) === String(placement.classId)
        && String(entry.academicYearId) === String(placement.academicYearId))) {
      entry.status = 'completed';
      entry.isCurrent = false;
    }
  });
  const enrollment = currentSchool.enrollments.find((entry) =>
    String(entry.studentId) === String(student.studentId)
    && String(entry.academicYearId) === String(placement.academicYearId)
    && String(entry.classId) === String(placement.classId)
  );
  if (enrollment) {
    Object.assign(enrollment, { status: 'active', isCurrent: true, admissionId });
  } else {
    currentSchool.enrollments.push({
      id: crypto.randomUUID(),
      studentId: student.studentId,
      classId: placement.classId,
      academicYearId: placement.academicYearId,
      admissionId,
      status: 'active',
      isCurrent: true,
      createdAt: new Date().toISOString(),
    });
  }
  saveSchoolData(schools);
  return enrollment || currentSchool.enrollments[currentSchool.enrollments.length - 1];
}

async function decideAdmission(schoolId, admissionId, { decision, classId, academicYearId, note } = {}, actor) {
  assertAuthority(actor, schoolId);
  const admission = await findAdmission(schoolId, admissionId);
  if (!admission) throw new Error('Admission application not found');
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['approved', 'rejected'].includes(normalizedDecision)) throw new Error('Decision must be approved or rejected.');
  if (admission.status === 'approved' && normalizedDecision === 'approved') {
    const school = await schoolService.getSchoolBySchoolId(schoolId);
    const student = school?.students?.find((entry) => String(entry.studentId) === String(admission.studentId));
    if (!student) throw new Error('The previously enrolled student record could not be found.');
    const placement = await validatePlacement(schoolId, admission, {
      classId: admission.classId,
      academicYearId: admission.academicYearId,
    });
    await persistEnrollment(schoolId, placement.school, student, placement, admission.id);
    return { admission, student, idempotent: true };
  }
  if (admission.status !== 'pending') throw new Error('Only pending applications can be decided.');
  if (normalizedDecision === 'rejected') {
    const updated = await persistAdmission(schoolId, {
      ...admission,
      status: 'rejected',
      reviewedBy: String(actor.userId || actor.username || actor.email || ''),
    }, admission.studentData, [...admission.history, makeHistory('rejected', actor, note)]);
    return { admission: updated, student: null, idempotent: false };
  }

  const placement = await validatePlacement(schoolId, admission, { classId, academicYearId });
  const email = normalizeEmail(admission.studentData.email);
  const existingStudent = (placement.school.students || []).find((entry) => normalizeEmail(entry.email) === email);
  let student;
  const studentData = {
    ...admission.studentData,
    classId: placement.classId,
    className: placement.classRecord.name || placement.classRecord.className || placement.classId,
    gradeLevel: admission.studentData.gradeLevel || placement.classRecord.grade || null,
    admissionNumber: admission.applicationNumber,
    currentAcademicYear: placement.yearRecord.label || placement.yearRecord.name || placement.yearRecord.id,
    enrollmentDate: new Date().toISOString(),
    status: 'active',
    metadata: {
      ...(admission.studentData.metadata || {}),
      admissionApplicationId: admission.id,
      academicYearId: placement.academicYearId,
      enrollmentHistory: [{
        classId: placement.classId,
        className: placement.classRecord.name || placement.classRecord.className || placement.classId,
        academicYearId: placement.academicYearId,
        admittedAt: new Date().toISOString(),
      }],
    },
  };
  if (existingStudent) {
    const linkedAdmission = existingStudent.metadata?.admissionApplicationId;
    if (linkedAdmission && linkedAdmission !== admission.id) {
      throw new Error('A student record already exists for this email and is linked to another admission.');
    }
    if (String(existingStudent.status || '').toLowerCase() === 'archived') {
      throw new Error('An archived student record exists for this email; restore or review it before admission.');
    }
    student = await schoolService.updateEntity(schoolId, 'students', existingStudent.studentId || existingStudent.id || email, {
      ...studentData,
      metadata: { ...(existingStudent.metadata || {}), ...studentData.metadata },
    }, actor);
  } else {
    studentData.studentId = createStudentIdentifier(placement.school, studentData.fullName);
    student = await schoolService.createEntity(schoolId, 'students', studentData, actor);
  }

  if (!student?.studentId) throw new Error('Student creation did not return a persisted student ID.');
  await persistEnrollment(schoolId, placement.school, student, placement, admission.id);
  const approved = await persistAdmission(schoolId, {
    ...admission,
    status: 'approved',
    studentId: student.studentId,
    classId: placement.classId,
    academicYearId: placement.academicYearId,
    reviewedBy: String(actor.userId || actor.username || actor.email || ''),
    enrolledAt: new Date().toISOString(),
  }, admission.studentData, [...admission.history, makeHistory('approved', actor, note)]);
  return { admission: approved, student, idempotent: false };
}

async function findAdmissionsByPhotoPath(schoolId, relativePath, actor) {
  assertTenantScope(actor, schoolId);
  const records = await loadAdmissions(schoolId);
  return records.filter((entry) => String(entry.profilePhotoPath || entry.studentData?.profilePhotoPath || '') === relativePath);
}

module.exports = {
  createAdmission,
  getAdmissions,
  getAdmission,
  updateAdmission,
  decideAdmission,
  findAdmissionsByPhotoPath,
};
