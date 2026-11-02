const firebaseData = require('./firebase.data');

const CORE_COLLECTIONS = Object.freeze({
  tenants: 'tenants',
  users: 'users',
  roles: 'roles',
  teachers: 'teachers',
  students: 'students',
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
  return { id: document.id, ...document.data() };
}

async function listTenants() {
  const snapshot = await collectionRef(CORE_COLLECTIONS.tenants).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
  return { id: document.id, ...document.data() };
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

    transaction.create(tenantDocument, { ...registration.tenant, id, schoolId: id });
    transaction.create(userDocument, registration.user);
    transaction.create(roleDocument, registration.role);
    transaction.create(classDocument, registration.defaultClass);
    transaction.create(enrollmentDocument, registration.enrollment);
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
  const payload = { ...data, schoolId: id, updatedAt: new Date().toISOString() };
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
    const payload = { ...updates, schoolId: id, updatedAt: new Date().toISOString() };
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
      transaction.create(reservationDocument, { schoolId: id, reservedAt: new Date().toISOString() });
    }
    transaction.delete(tenantDocument);
    return { schoolId: id, name: tenant.name || null, archivedAt: tenant.archivedAt };
  });
}

async function listBySchool(collectionName, schoolId) {
  const snapshot = await collectionRef(collectionName).where('schoolId', '==', assertSchoolId(schoolId)).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function getById(collectionName, id) {
  const snapshot = await collectionRef(collectionName).doc(String(id)).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function saveById(collectionName, id, data, merge = true) {
  const documentId = String(id || '').trim();
  if (!documentId) throw new Error('A Firebase document ID is required.');
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await collectionRef(collectionName).doc(documentId).set(payload, { merge });
  return { id: documentId, ...payload };
}

async function createById(collectionName, id, data) {
  const documentId = String(id || '').trim();
  if (!documentId) throw new Error('A Firebase document ID is required.');
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await collectionRef(collectionName).doc(documentId).create(payload);
  return { id: documentId, ...payload };
}

async function deleteById(collectionName, id) {
  await collectionRef(collectionName).doc(String(id)).delete();
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
  const [users, teachers, students, classes, enrollments] = await Promise.all([
    listBySchool(CORE_COLLECTIONS.users, schoolId),
    listBySchool(CORE_COLLECTIONS.teachers, schoolId),
    listBySchool(CORE_COLLECTIONS.students, schoolId),
    listBySchool(CORE_COLLECTIONS.classes, schoolId),
    listBySchool(CORE_COLLECTIONS.enrollments, schoolId),
  ]);
  return {
    ...tenant,
    users,
    teachers,
    students,
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
  createById,
  deleteById,
  getMaintenanceMode,
  setMaintenanceMode,
  getSchoolAggregate,
};
