jest.mock('../../../firebase.data', () => ({
  isFirebaseDataConfigured: jest.fn(),
  getFirestore: jest.fn(),
}));

const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');

const SCHOOL_ID = 'firebase-archive-school-001';

function createFirestore({
  archivedAt = '2026-10-02T00:00:00.000Z',
  childCollections = [],
  populatedRootCollection = null,
  reservedSchoolId = false,
  tenantExists = true,
} = {}) {
  const tenantDocument = {
    id: SCHOOL_ID,
    collectionName: 'tenants',
    listCollections: jest.fn(async () => childCollections),
  };
  const reservationDocument = {
    id: SCHOOL_ID,
    collectionName: 'schoolIdReservations',
  };
  const writes = [];
  const transaction = {
    get: jest.fn(async (target) => {
      if (target === tenantDocument) {
        return { exists: tenantExists, data: () => ({ schoolId: SCHOOL_ID, name: 'Archived school', archivedAt }) };
      }
      if (target === reservationDocument) return { exists: reservedSchoolId, data: () => ({ schoolId: SCHOOL_ID }) };
      return { empty: target.collectionName !== populatedRootCollection };
    }),
    delete: jest.fn(),
    create: jest.fn((document, data) => writes.push({ document, data })),
  };
  const firestore = {
    collection: jest.fn((name) => {
      const query = {
        collectionName: name,
        doc: jest.fn((id) => {
          if (name === 'tenants') return tenantDocument;
          if (name === 'schoolIdReservations') return reservationDocument;
          return { id: String(id), collectionName: name };
        }),
        where() { return this; },
        limit() { return this; },
      };
      return query;
    }),
    runTransaction: jest.fn((callback) => callback(transaction)),
  };
  return { firestore, tenantDocument, reservationDocument, transaction, writes };
}

describe('Firebase school archive deletion guard', () => {
  beforeEach(() => {
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
  });

  it('deletes an archived tenant only when its root collections and subcollections are empty', async () => {
    const { firestore, transaction } = createFirestore();
    firebaseData.getFirestore.mockReturnValue(firestore);

    const result = await firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID);

    expect(result.schoolId).toBe(SCHOOL_ID);
    expect(transaction.delete).toHaveBeenCalledTimes(1);
    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: 'schoolIdReservations' }),
      expect.objectContaining({ schoolId: SCHOOL_ID }),
    );
  });

  it('blocks deletion when a tenant subcollection contains school data', async () => {
    const childCollection = { id: 'attendanceRecords' };
    const { firestore, transaction } = createFirestore({ childCollections: [childCollection] });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await expect(firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it('blocks deletion when a root school-scoped collection contains records', async () => {
    const { firestore, transaction } = createFirestore({ populatedRootCollection: 'users' });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await expect(firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it.each(['assignments', 'lessons', 'messages'])('blocks deletion when %s remain for the tenant', async (collectionName) => {
    const { firestore, transaction } = createFirestore({ populatedRootCollection: collectionName });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await expect(firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it('preserves an existing tenant ID reservation during permanent deletion', async () => {
    const { firestore, transaction } = createFirestore({ reservedSchoolId: true });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID);

    expect(transaction.create).not.toHaveBeenCalled();
    expect(transaction.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects registration when a previously used tenant ID is reserved', async () => {
    const { firestore } = createFirestore({ reservedSchoolId: true, tenantExists: false });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await expect(firebaseCore.createTenantRegistration(SCHOOL_ID, {
      tenant: { name: 'Replacement school' },
      user: { email: 'replacement@example.test' },
      role: {},
      defaultClass: {},
      enrollment: {},
    })).rejects.toMatchObject({ code: 'SCHOOL_ID_RESERVED' });
  });

  it('does not create a permanent ID reservation for an active school registration', async () => {
    const { firestore, transaction } = createFirestore({ tenantExists: false });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await firebaseCore.createTenantRegistration(SCHOOL_ID, {
      tenant: { name: 'New school' },
      user: { email: 'new@example.test' },
      role: {},
      defaultClass: {},
      enrollment: {},
    });

    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: 'tenants' }),
      expect.objectContaining({ schoolId: SCHOOL_ID }),
    );
    expect(transaction.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: 'schoolIdReservations' }),
      expect.objectContaining({ schoolId: SCHOOL_ID }),
    );
  });

  it('blocks deletion when root role records still belong to the school', async () => {
    const { firestore, transaction } = createFirestore({ populatedRootCollection: 'roles' });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await expect(firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_HAS_DEPENDENCIES' });
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it('independently rejects a tenant that is not archived', async () => {
    const { firestore, transaction } = createFirestore({ archivedAt: null });
    firebaseData.getFirestore.mockReturnValue(firestore);

    await expect(firebaseCore.deleteArchivedTenantIfEmpty(SCHOOL_ID))
      .rejects.toMatchObject({ code: 'SCHOOL_NOT_ARCHIVED' });
    expect(transaction.delete).not.toHaveBeenCalled();
  });
});