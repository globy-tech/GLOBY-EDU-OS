const fs = require('fs');
const path = require('path');

const projectId = 'demo-globyedu-security-rules';
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment;
let assertFails;
let assertSucceeds;
let initializeTestEnvironment;
let collection;
let doc;
let getDocs;
let getDoc;
let setDoc;
let updateDoc;
let deleteDoc;

function authenticatedContext(uid, role, tenantId = 'school-a') {
  const isPlatformAdmin = role === 'super_admin';
  return testEnvironment.authenticatedContext(uid, {
    role,
    roles: [role],
    platformAdmin: isPlatformAdmin,
    tenantId: isPlatformAdmin ? null : tenantId,
    schoolId: isPlatformAdmin ? null : tenantId,
  });
}

describeWithFirestoreEmulator('Firestore backend-only data access rules', () => {
  beforeAll(async () => {
    ({ assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing'));
    ({ collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore'));
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: {
        host,
        port: Number(port),
        rules: fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
      },
    });
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, 'tenants', 'school-a'), { schoolId: 'school-a' }),
        setDoc(doc(db, 'students', 'school-a:student-a'), { schoolId: 'school-a' }),
        setDoc(doc(db, 'students', 'school-b:student-b'), { schoolId: 'school-b' }),
        setDoc(doc(db, 'teachers', 'school-a:teacher-a'), { schoolId: 'school-a' }),
        setDoc(doc(db, 'teachers', 'school-b:teacher-b'), { schoolId: 'school-b' }),
        setDoc(doc(db, 'classes', 'school-a:class-a'), { schoolId: 'school-a' }),
        setDoc(doc(db, 'classes', 'school-b:class-b'), { schoolId: 'school-b' }),
        setDoc(doc(db, 'enrollments', 'school-a:enrollment-a'), { schoolId: 'school-a', studentId: 'student-a' }),
        setDoc(doc(db, 'payments', 'school-a:payment-a'), { schoolId: 'school-a' }),
        setDoc(doc(db, 'accountDeletionJobs', 'school-a:job-a'), { schoolId: 'school-a' }),
        setDoc(doc(db, 'pricingPlans', 'standard'), { name: 'Standard' }),
      ]);
    });
  });

  test.each(['school_authority', 'teacher', 'student', 'super_admin'])(
    '%s cannot directly read or write private Firestore records',
    async (role) => {
      const db = authenticatedContext(`${role}-uid`, role).firestore();
      const protectedPaths = [
        ['tenants', 'school-a'],
        ['users', 'school-a:student-a'],
        ['students', 'school-a:student-a'],
        ['students', 'school-b:student-b'],
        ['teachers', 'school-a:teacher-a'],
        ['teachers', 'school-b:teacher-b'],
        ['classes', 'school-a:class-a'],
        ['classes', 'school-b:class-b'],
        ['enrollments', 'school-a:enrollment-a'],
        ['payments', 'school-a:payment-a'],
        ['accountDeletionJobs', 'school-a:job-a'],
      ];

      for (const [collectionName, documentId] of protectedPaths) {
        const reference = doc(db, collectionName, documentId);
        await assertFails(getDoc(reference));
        await assertFails(setDoc(reference, { schoolId: 'school-a' }));
        await assertFails(updateDoc(reference, { schoolId: 'school-a' }));
        await assertFails(deleteDoc(reference));
      }

      for (const collectionName of ['students', 'teachers', 'classes', 'enrollments']) {
        await assertFails(getDocs(collection(db, collectionName)));
      }
    }
  );

  test('public users can read pricing plans, and only a genuine Super Admin can write them', async () => {
    const publicDb = testEnvironment.unauthenticatedContext().firestore();
    const adminDb = authenticatedContext('root-uid', 'super_admin').firestore();
    const authorityDb = authenticatedContext('authority-uid', 'school_authority').firestore();

    await assertSucceeds(getDoc(doc(publicDb, 'pricingPlans', 'standard')));
    await assertSucceeds(setDoc(doc(adminDb, 'pricingPlans', 'premium'), { name: 'Premium' }));
    await assertFails(setDoc(doc(authorityDb, 'pricingPlans', 'forged'), { name: 'Forged' }));

    const forgedAdminDb = testEnvironment.authenticatedContext('forged-admin', {
      role: 'super_admin',
      roles: ['super_admin'],
      platformAdmin: false,
      tenantId: 'school-a',
      schoolId: 'school-a',
    }).firestore();
    await assertFails(setDoc(doc(forgedAdminDb, 'pricingPlans', 'forged-admin'), { name: 'Forged' }));
  });

  test('trusted backend Admin SDK operations remain available outside client rules', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await assertSucceeds(setDoc(doc(context.firestore(), 'users', 'school-a:provisioned'), {
        email: 'provisioned@example.test',
        schoolId: 'school-a',
        tenantId: 'school-a',
        role: 'teacher',
      }));
    });
  });
});

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  describe('Firestore Emulator test prerequisite', () => {
    test.skip('run with FIRESTORE_EMULATOR_HOST set to an isolated Firestore emulator', () => {});
  });
}
