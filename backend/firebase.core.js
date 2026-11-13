const firebaseData = require('./firebase.data');
const { sanitizeFirestoreData } = require('./firestore-data');

const CORE_COLLECTIONS = Object.freeze({
  tenants: 'tenants',
  users: 'users',
  roles: 'roles',
  teachers: 'teachers',
  students: 'students',
  admissions: 'admissions',
  classes: 'classes',
  enrollments: 'enrollments',
  payments: 'payments',
  subscriptions: 'subscriptions',
  refundRequests: 'refundRequests',
  assignments: 'assignments',
  lessons: 'lessons',
  messages: 'messages',
  platformSettings: 'platformSettings',
  schoolIdReservations: 'schoolIdReservations',
  accountDeletionJobs: 'accountDeletionJobs',
});

function isFirebaseCoreMode() {
  return firebaseData.isFirebaseDataConfigured();
}

function assertSchoolId(schoolId) {
  const value = String(schoolId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid school ID.');
  return value;
}

function tenantRef(schoolId) {
  return firebaseData.getFirestore().collection(CORE_COLLECTIONS.tenants).doc(assertSchoolId(schoolId));
}

function collectionRef(collectionName) {
  if (!Object.values(CORE_COLLECTIONS).includes(collectionName)) throw new Error('Unsupported Firebase core collection.');
  return firebaseData.getFirestore().collection(collectionName);
}

async function getTenant(schoolId) {
  const snapshot = await tenantRef(schoolId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function findTenantByHeadEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const snapshot = await collectionRef(CORE_COLLECTIONS.tenants)
    .where('headEmail', '==', normalizedEmail)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const document = snapshot.docs[0];
  return { ...document.data(), id: document.id };
}

async function listTenants() {
  const snapshot = await collectionRef(CORE_COLLECTIONS.tenants).get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const snapshot = await collectionRef(CORE_COLLECTIONS.users)
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const document = snapshot.docs[0];
  return { ...document.data(), id: document.id };
}

async function createTenantRegistration(schoolId, registration) {
  const id = assertSchoolId(schoolId);
  const firestore = firebaseData.getFirestore();
  const tenantDocument = tenantRef(id);
  const reservationDocument = collectionRef(CORE_COLLECTIONS.schoolIdReservations).doc(id);
  const headEmail = String(registration.user.email || '').trim().toLowerCase();
  const userDocument = collectionRef(CORE_COLLECTIONS.users).doc(`${id}:${headEmail}`);
  const roleDocument = collectionRef(CORE_COLLECTIONS.roles).doc(`${id}:school_head`);
  const classDocument = collectionRef(CORE_COLLECTIONS.classes).doc(`${id}:class-01`);
  const enrollmentDocument = collectionRef(CORE_COLLECTIONS.enrollments).doc(`${id}:${headEmail}`);

  await firestore.runTransaction(async (transaction) => {
    const [tenantSnapshot, reservationSnapshot, ownerSnapshot, userSnapshot] = await Promise.all([
      transaction.get(tenantDocument),
      transaction.get(reservationDocument),
      transaction.get(collectionRef(CORE_COLLECTIONS.tenants).where('headEmail', '==', headEmail).limit(1)),
      transaction.get(collectionRef(CORE_COLLECTIONS.users).where('email', '==', headEmail).limit(1)),
    ]);
    if (tenantSnapshot.exists) {
      const error = new Error('A school with that ID already exists');
      error.code = 'SCHOOL_ID_EXISTS';
      throw error;
    }
    if (reservationSnapshot.exists) {
      const error = new Error('A school with that ID has already existed and cannot be reused.');
      error.code = 'SCHOOL_ID_RESERVED';
      throw error;
    }
    if (!ownerSnapshot.empty || !userSnapshot.empty) {
      const error = new Error('A school registration already exists for this authority email.');
      error.code = 'SCHOOL_REGISTRATION_EXISTS';
      throw error;
    }

    transaction.create(tenantDocument, sanitizeFirestoreData({ ...registration.tenant, id, schoolId: id }));
    transaction.create(userDocument, sanitizeFirestoreData(registration.user));
    transaction.create(roleDocument, sanitizeFirestoreData(registration.role));
    transaction.create(classDocument, sanitizeFirestoreData(registration.defaultClass));
    transaction.create(enrollmentDocument, sanitizeFirestoreData(registration.enrollment));
  });

  return { id, schoolId: id, ...registration.tenant };
}

async function deletePendingTenantRegistration(schoolId, email) {
  const id = assertSchoolId(schoolId);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const firestore = firebaseData.getFirestore();
  const documents = [
    tenantRef(id),
    collectionRef(CORE_COLLECTIONS.users).doc(`${id}:${normalizedEmail}`),
    collectionRef(CORE_COLLECTIONS.roles).doc(`${id}:school_head`),
    collectionRef(CORE_COLLECTIONS.classes).doc(`${id}:class-01`),
    collectionRef(CORE_COLLECTIONS.enrollments).doc(`${id}:${normalizedEmail}`),
  ];

  return firestore.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(documents.map((document) => transaction.get(document)));
    const tenant = snapshots[0].exists ? snapshots[0].data() : null;
    const user = snapshots[1].exists ? snapshots[1].data() : null;
    if (!tenant) return true;
    if (String(tenant.headEmail || '').trim().toLowerCase() !== normalizedEmail ||
        !user || String(user.email || '').trim().toLowerCase() !== normalizedEmail ||
        user.isVerified === true || user.emailVerified === true) {
      return false;
    }
    documents.forEach((document) => transaction.delete(document));
    return true;
  });
}

async function saveTenant(schoolId, data, merge = true) {
  const id = assertSchoolId(schoolId);
  const payload = sanitizeFirestoreData({ ...data, schoolId: id, updatedAt: new Date().toISOString() });
  await tenantRef(id).set(payload, { merge });
  return { id, ...payload };
}

async function updateTenantInTransaction(schoolId, update) {
  const id = assertSchoolId(schoolId);
  const document = tenantRef(id);
  return firebaseData.getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) throw new Error('School not found');

    const tenant = { id: snapshot.id, ...snapshot.data() };
    const { updates = {}, result } = update(tenant);
    const payload = sanitizeFirestoreData({ ...updates, schoolId: id, updatedAt: new Date().toISOString() });
    transaction.set(document, payload, { merge: true });
    return { tenant: { ...tenant, ...payload }, result };
  });
}

async function deleteArchivedTenantIfEmpty(schoolId) {
  const id = assertSchoolId(schoolId);
  const firestore = firebaseData.getFirestore();
  const tenantDocument = tenantRef(id);
  const schoolScopedCollections = [
    CORE_COLLECTIONS.users,
    CORE_COLLECTIONS.roles,
    CORE_COLLECTIONS.teachers,
    CORE_COLLECTIONS.students,
    CORE_COLLECTIONS.classes,
    CORE_COLLECTIONS.enrollments,
    CORE_COLLECTIONS.payments,
    CORE_COLLECTIONS.subscriptions,
    CORE_COLLECTIONS.refundRequests,
    CORE_COLLECTIONS.assignments,
    CORE_COLLECTIONS.lessons,
    CORE_COLLECTIONS.messages,
  ];
  const reservationDocument = collectionRef(CORE_COLLECTIONS.schoolIdReservations).doc(id);

  return firestore.runTransaction(async (transaction) => {
    const tenantSnapshot = await transaction.get(tenantDocument);
    const reservationSnapshot = await transaction.get(reservationDocument);
    if (!tenantSnapshot.exists) {
      const error = new Error('School not found');
      error.code = 'SCHOOL_NOT_FOUND';
      throw error;
    }

    const tenant = tenantSnapshot.data() || {};
    if (!tenant.archivedAt) {
      const error = new Error('Only archived schools can be permanently deleted');
      error.code = 'SCHOOL_NOT_ARCHIVED';
      throw error;
    }

    const tenantSubcollections = await tenantDocument.listCollections();
    if (tenantSubcollections.length) {
      const error = new Error(`Permanent deletion is blocked while tenant subcollections exist: ${tenantSubcollections.map((collection) => collection.id).join(', ')}.`);
      error.code = 'SCHOOL_HAS_DEPENDENCIES';
      throw error;
    }

    const snapshots = await Promise.all(schoolScopedCollections.map((name) =>
      transaction.get(collectionRef(name).where('schoolId', '==', id).limit(1))
    ));
    if (snapshots.some((snapshot) => !snapshot.empty)) {
      const error = new Error('Permanent deletion is blocked while related school records exist.');
      error.code = 'SCHOOL_HAS_DEPENDENCIES';
      throw error;
    }

    if (!reservationSnapshot.exists) {
      transaction.create(reservationDocument, sanitizeFirestoreData({ schoolId: id, reservedAt: new Date().toISOString() }));
    }
    transaction.delete(tenantDocument);
    return { schoolId: id, name: tenant.name || null, archivedAt: tenant.archivedAt };
  });
}

async function listBySchool(collectionName, schoolId, { preserveDataId = false } = {}) {
  const snapshot = await collectionRef(collectionName).where('schoolId', '==', assertSchoolId(schoolId)).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...data, id: preserveDataId && data.id ? data.id : doc.id };
  });
}

async function getById(collectionName, id, { preserveDataId = false } = {}) {
  const snapshot = await collectionRef(collectionName).doc(String(id)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return { ...data, id: preserveDataId && data.id ? data.id : snapshot.id };
}

async function saveById(collectionName, id, data, merge = true) {
  const documentId = String(id || '').trim();
  if (!documentId) throw new Error('A Firebase document ID is required.');
  const payload = sanitizeFirestoreData({ ...data, updatedAt: new Date().toISOString() });
  await collectionRef(collectionName).doc(documentId).set(payload, { merge });
  return { id: documentId, ...payload };
}

async function updateById(collectionName, id, data) {
  const documentId = String(id || '').trim();
  if (!documentId) throw new Error('A Firebase document ID is required.');
  const payload = sanitizeFirestoreData({ ...data, updatedAt: new Date().toISOString() });
  const reference = collectionRef(collectionName).doc(documentId);
  return firebaseData.getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return false;
    transaction.update(reference, payload);
    return true;
  });
}

async function createById(collectionName, id, data) {
  const documentId = String(id || '').trim();
  if (!documentId) throw new Error('A Firebase document ID is required.');
  const payload = sanitizeFirestoreData({ ...data, updatedAt: new Date().toISOString() });
  await collectionRef(collectionName).doc(documentId).create(payload);
  return { id: documentId, ...payload };
}

async function runClassMutation(schoolId, classIds, operation) {
  const schoolKey = assertSchoolId(schoolId);
  const classDocumentIds = [...new Set((Array.isArray(classIds) ? classIds : [classIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value.startsWith(`${schoolKey}:`) ? value : `${schoolKey}:${value}`))];
  if (!classDocumentIds.length) throw new Error('At least one class is required for this mutation.');

  const references = classDocumentIds.map((id) => collectionRef(CORE_COLLECTIONS.classes).doc(id));
  return firebaseData.getFirestore().runTransaction(async (transaction) => {
    const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
    const missingClass = snapshots.find((snapshot) => !snapshot.exists);
    if (missingClass) throw new Error('Class does not belong to this school');

    const classRecords = snapshots.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }));
    const updates = await operation({
      transaction,
      classRecords,
      classReferences: references,
      getDocumentReference: (collectionName, id) => collectionRef(collectionName).doc(String(id)),
      getSchoolQuery: (collectionName) => collectionRef(collectionName).where('schoolId', '==', schoolKey),
      sanitizeData: sanitizeFirestoreData,
    });
    const classUpdatesById = updates?.classUpdatesById || {};
    for (const reference of references) {
      transaction.set(reference, sanitizeFirestoreData({
        ...(classUpdatesById[reference.id] || {}),
        updatedAt: new Date().toISOString(),
      }), { merge: true });
    }
    return updates && Object.hasOwn(updates, 'result') ? updates.result : updates;
  });
}

async function commitAcademicProgression({
  schoolId,
  studentId,
  fromAcademicYearId,
  sourceClassId,
  targetAcademicYearId,
  targetClassId,
  operationId,
  action,
  student,
  userId,
  user,
  targetEnrollment,
}) {
  const tenantId = assertSchoolId(schoolId);
  const studentKey = String(studentId || '').trim();
  const operationKey = String(operationId || '').trim();
  if (!studentKey || !operationKey) throw new Error('Student and operation IDs are required.');

  const studentRef = collectionRef(CORE_COLLECTIONS.students).doc(`${tenantId}:${studentKey}`);
  const sourceClassRef = sourceClassId
    ? collectionRef(CORE_COLLECTIONS.classes).doc(`${tenantId}:${sourceClassId}`)
    : null;
  const targetClassRef = targetClassId
    ? collectionRef(CORE_COLLECTIONS.classes).doc(`${tenantId}:${targetClassId}`)
    : null;
  const userRef = userId ? collectionRef(CORE_COLLECTIONS.users).doc(`${tenantId}:${userId}`) : null;
  const enrollmentQuery = collectionRef(CORE_COLLECTIONS.enrollments)
    .where('schoolId', '==', tenantId)
    .where('studentId', '==', studentKey);

  return firebaseData.getFirestore().runTransaction(async (transaction) => {
    const [studentSnapshot, sourceSnapshot, targetSnapshot, enrollmentSnapshot] = await Promise.all([
      transaction.get(studentRef),
      sourceClassRef ? transaction.get(sourceClassRef) : Promise.resolve(null),
      targetClassRef ? transaction.get(targetClassRef) : Promise.resolve(null),
      transaction.get(enrollmentQuery),
    ]);
    if (!studentSnapshot.exists) throw new Error('Student not found in this school.');

    const currentStudent = studentSnapshot.data();
    if (currentStudent.schoolId !== tenantId) throw new Error('Student does not belong to this school.');
    const metadata = currentStudent.metadata && typeof currentStudent.metadata === 'object' ? currentStudent.metadata : {};
    const previousOperation = (Array.isArray(metadata.progressionHistory) ? metadata.progressionHistory : [])
      .find((entry) => entry.operationId === operationKey);
    if (previousOperation) {
      if (previousOperation.action !== action
        || String(previousOperation.fromAcademicYearId) !== String(fromAcademicYearId)
        || String(previousOperation.toAcademicYearId) !== String(targetAcademicYearId)
        || (targetClassId && String(previousOperation.toClassId) !== String(targetClassId))) {
        throw new Error(`Progression operation ${operationKey} was already applied with a different decision.`);
      }
      return { idempotent: true };
    }

    const currentClassId = currentStudent.classId || metadata.classId || '';
    const currentYearId = currentStudent.academicYearId || currentStudent.currentAcademicYear || metadata.academicYearId || '';
    if (String(currentClassId) !== String(sourceClassId)
      || String(currentYearId) !== String(fromAcademicYearId)) {
      throw new Error('The student placement changed after the progression preview. Generate a new preview.');
    }

    const sourceClass = sourceSnapshot?.exists ? sourceSnapshot.data() : null;
    const targetClass = targetSnapshot?.exists ? targetSnapshot.data() : null;
    if (sourceClassId && (!sourceClass || sourceClass.schoolId !== tenantId
      || String(sourceClass.academicYearId || sourceClass.academicYear) !== String(fromAcademicYearId))) {
      throw new Error('The source class no longer belongs to this school and academic year.');
    }
    if (targetClassId && (!targetClass || targetClass.schoolId !== tenantId
      || String(targetClass.academicYearId || targetClass.academicYear) !== String(targetAcademicYearId))) {
      throw new Error('The target class no longer belongs to this school and academic year.');
    }
    if (targetClassId && String(targetClass.status || 'active').toLowerCase() === 'archived') {
      throw new Error('Students cannot be enrolled in an archived class.');
    }

    const enrollmentDocuments = enrollmentSnapshot.docs || [];
    if (targetClassId && enrollmentDocuments.some((document) => {
      const enrollment = document.data();
      return String(enrollment.academicYearId) === String(targetAcademicYearId)
        && enrollment.isCurrent !== false
        && String(enrollment.status || 'active').toLowerCase() === 'active';
    })) {
      throw new Error(`A current enrollment already exists for ${studentKey} in the target academic year.`);
    }

    const now = new Date().toISOString();
    const writes = [];
    if (sourceClass) {
      writes.push([sourceClassRef, {
        ...sourceClass,
        studentIds: (sourceClass.studentIds || []).filter((id) => String(id).split(':').pop().trim().toLowerCase() !== studentKey.toLowerCase()),
        schoolId: tenantId,
        updatedAt: now,
      }]);
    }
    if (targetClass) {
      const targetStudents = (targetClass.studentIds || []).filter((id) => String(id).split(':').pop().trim().toLowerCase() !== studentKey.toLowerCase());
      targetStudents.push(studentKey);
      writes.push([targetClassRef, { ...targetClass, studentIds: targetStudents, schoolId: tenantId, updatedAt: now }]);
    }
    enrollmentDocuments.forEach((document) => {
      const enrollment = document.data();
      if (enrollment.isCurrent !== false && String(enrollment.status || 'active').toLowerCase() === 'active') {
        writes.push([document.ref, {
          ...enrollment,
          isCurrent: false,
          status: ['promote', 'repeat', 'manual'].includes(action) ? 'completed' : action,
          updatedAt: now,
        }]);
      }
    });
    if (targetEnrollment) {
      const enrollmentId = String(targetEnrollment.id || '');
      const documentId = enrollmentId.startsWith(`${tenantId}:`) ? enrollmentId : `${tenantId}:${enrollmentId}`;
      writes.push([collectionRef(CORE_COLLECTIONS.enrollments).doc(documentId), {
        ...targetEnrollment,
        id: documentId,
        schoolId: tenantId,
        updatedAt: now,
      }]);
    }
    writes.push([studentRef, { ...student, schoolId: tenantId, updatedAt: now }]);
    if (userRef && user) writes.push([userRef, { ...user, schoolId: tenantId, tenantId, updatedAt: now }]);

    writes.forEach(([reference, data]) => {
      transaction.set(reference, sanitizeFirestoreData(data), { merge: true });
    });
    return { idempotent: false };
  });
}

async function deleteById(collectionName, id) {
  await collectionRef(collectionName).doc(String(id)).delete();
}

async function deleteSessionsForUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) throw new Error('A Firebase user ID is required.');
  const firestore = firebaseData.getFirestore();
  const snapshot = await firestore.collection('authSessions')
    .where('userId', '==', normalizedUserId)
    .get();
  const documents = snapshot.docs || [];
  for (let offset = 0; offset < documents.length; offset += 500) {
    const batch = firestore.batch();
    documents.slice(offset, offset + 500).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
  return documents.length;
}

async function getMaintenanceMode() {
  if (!isFirebaseCoreMode()) return false;
  const settings = await getById('platformSettings', 'global');
  return settings?.maintenanceMode === true;
}

async function setMaintenanceMode(enabled, updatedBy = null) {
  if (!isFirebaseCoreMode()) throw new Error('Firebase platform settings are unavailable.');
  return saveById('platformSettings', 'global', {
    maintenanceMode: enabled === true,
    updatedBy: updatedBy ? String(updatedBy) : null,
  });
}

async function getSchoolAggregate(schoolId) {
  const tenant = await getTenant(schoolId);
  if (!tenant) return null;
  const [users, teachers, students, admissions, classes, enrollments] = await Promise.all([
    listBySchool(CORE_COLLECTIONS.users, schoolId),
    listBySchool(CORE_COLLECTIONS.teachers, schoolId),
    listBySchool(CORE_COLLECTIONS.students, schoolId),
    listBySchool(CORE_COLLECTIONS.admissions, schoolId),
    listBySchool(CORE_COLLECTIONS.classes, schoolId),
    listBySchool(CORE_COLLECTIONS.enrollments, schoolId),
  ]);
  return {
    ...tenant,
    users,
    teachers,
    students,
    admissions,
    classes,
    enrollments,
  };
}

module.exports = {
  CORE_COLLECTIONS,
  isFirebaseCoreMode,
  getTenant,
  findTenantByHeadEmail,
  listTenants,
  findUserByEmail,
  createTenantRegistration,
  deletePendingTenantRegistration,
  saveTenant,
  updateTenantInTransaction,
  deleteArchivedTenantIfEmpty,
  listBySchool,
  getById,
  saveById,
  updateById,
  createById,
  runClassMutation,
  commitAcademicProgression,
  deleteById,
  deleteSessionsForUser,
  getMaintenanceMode,
  setMaintenanceMode,
  getSchoolAggregate,
};
