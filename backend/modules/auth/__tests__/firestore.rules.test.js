const fs = require('fs');
const path = require('path');

const projectId = 'demo-globyedu-security-rules';
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment;
let assertFails;
let assertSucceeds;
let initializeTestEnvironment;
let doc;
let collection;
let getDocs;
let getDoc;
let setDoc;
let updateDoc;

function tenantContext(uid, role) {
  return testEnvironment.authenticatedContext(uid, {
    role,
    roles: [role],
    platformAdmin: false,
    tenantId: 'school-a',
    schoolId: 'school-a',
  });
}

describeWithFirestoreEmulator('Firestore tenant and Super Admin security rules', () => {
  beforeAll(async () => {
    ({ assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing'));
    ({ collection, doc, getDoc, getDocs, setDoc, updateDoc } = require('firebase/firestore'));
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
  });

  test('tenant user cannot create a Super Admin user record', async () => {
    const db = tenantContext('school-a-user', 'school_authority').firestore();
    await assertFails(setDoc(doc(db, 'users', 'school-a:attacker'), {
      email: 'attacker@example.test',
      schoolId: 'school-a',
      tenantId: 'school-a',
      role: 'super_admin',
      roles: ['super_admin'],
      platformAdmin: true,
      firebaseUid: 'attacker-auth-uid',
    }));
  });

  test.each(['school_authority', 'teacher', 'student'])('%s cannot read or list same-tenant user records', async (role) => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'school-a:other-user'), {
        email: 'other-user@example.test',
        schoolId: 'school-a',
        tenantId: 'school-a',
        role: 'student',
        passwordHash: 'bcrypt-hash',
      });
    });

    const db = tenantContext(`${role}-a`, role).firestore();
    await assertFails(getDoc(doc(db, 'users', 'school-a:other-user')));
    await assertFails(getDocs(collection(db, 'users')));
  });

  test('tenant user cannot change an existing user role to Super Admin', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'school-a:user-1'), {
        email: 'user@example.test',
        schoolId: 'school-a',
        tenantId: 'school-a',
        role: 'teacher',
        roles: ['teacher'],
        platformAdmin: false,
        firebaseUid: 'user-auth-uid',
      });
    });
    const db = tenantContext('school-a-authority', 'school_authority').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'school-a:user-1'), {
      role: 'super_admin',
      roles: ['super_admin'],
      platformAdmin: true,
    }));
  });

  test('tenant user cannot change school or Firebase identity linkage fields', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'school-a:user-2'), {
        email: 'user2@example.test',
        schoolId: 'school-a',
        tenantId: 'school-a',
        role: 'teacher',
        roles: ['teacher'],
        platformAdmin: false,
        firebaseUid: 'user-2-auth-uid',
      });
    });
    const db = tenantContext('school-a-authority', 'school_authority').firestore();
    const userRef = doc(db, 'users', 'school-a:user-2');
    await assertFails(updateDoc(userRef, { schoolId: 'school-b', tenantId: 'school-b' }));
    await assertFails(updateDoc(userRef, { firebaseUid: 'other-auth-uid' }));
    await assertFails(updateDoc(userRef, { googleUid: 'other-google-uid' }));
    await assertFails(updateDoc(userRef, { platformAdmin: true }));
    await assertFails(updateDoc(userRef, { customClaims: { role: 'super_admin', platformAdmin: true } }));
  });

  test('tenant manager cannot reassign records owned by another tenant', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'roles', 'role-school-b'), { schoolId: 'school-b', name: 'Teacher' });
      await setDoc(doc(db, 'teachers', 'teacher-school-b'), { schoolId: 'school-b', name: 'Teacher B' });
      await setDoc(doc(db, 'students', 'student-school-b'), { schoolId: 'school-b', name: 'Student B' });
      await setDoc(doc(db, 'classes', 'class-school-b'), { schoolId: 'school-b', name: 'Class B' });
      await setDoc(doc(db, 'enrollments', 'enrollment-school-b'), { schoolId: 'school-b', studentId: 'student-school-b' });
    });

    const db = tenantContext('school-a-authority', 'school_authority').firestore();
    await assertFails(updateDoc(doc(db, 'roles', 'role-school-b'), { schoolId: 'school-a' }));
    await assertFails(updateDoc(doc(db, 'teachers', 'teacher-school-b'), { schoolId: 'school-a' }));
    await assertFails(updateDoc(doc(db, 'students', 'student-school-b'), { schoolId: 'school-a' }));
    await assertFails(updateDoc(doc(db, 'classes', 'class-school-b'), { schoolId: 'school-a' }));
    await assertFails(updateDoc(doc(db, 'enrollments', 'enrollment-school-b'), { schoolId: 'school-a' }));
  });

  test('genuine Super Admin retains cross-tenant admin access; role-only claims do not', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tenants', 'school-b'), { name: 'School B', schoolId: 'school-b' });
      await setDoc(doc(context.firestore(), 'users', 'school-b:user-1'), {
        email: 'school-b@example.test', schoolId: 'school-b', role: 'teacher',
      });
    });
    const adminDb = testEnvironment.authenticatedContext('root-uid', {
      role: 'super_admin',
      roles: ['super_admin'],
      platformAdmin: true,
      tenantId: null,
      schoolId: null,
    }).firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'tenants', 'school-b')));
    await assertSucceeds(updateDoc(doc(adminDb, 'tenants', 'school-b'), { name: 'Updated by platform admin' }));

    const roleOnlyDb = testEnvironment.authenticatedContext('forged-role-uid', {
      role: 'super_admin',
      roles: ['super_admin'],
      platformAdmin: false,
      tenantId: 'school-a',
      schoolId: 'school-a',
    }).firestore();
    await assertFails(getDoc(doc(roleOnlyDb, 'tenants', 'school-b')));
  });

  test('School Authority, Teacher, and Student retain normal same-tenant operations', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'tenants', 'school-a'), { name: 'School A', schoolId: 'school-a' });
      await setDoc(doc(db, 'students', 'student-a'), { schoolId: 'school-a', studentId: 'student-a' });
      await setDoc(doc(db, 'tenants', 'school-b'), { name: 'School B', schoolId: 'school-b' });
    });

    const authorityDb = tenantContext('authority-a', 'school_authority').firestore();
    await assertSucceeds(getDoc(doc(authorityDb, 'tenants', 'school-a')));
    await assertSucceeds(updateDoc(doc(authorityDb, 'tenants', 'school-a'), { name: 'Updated by authority' }));

    const teacherDb = tenantContext('teacher-a', 'teacher').firestore();
    await assertSucceeds(setDoc(doc(teacherDb, 'classes', 'class-a'), {
      schoolId: 'school-a',
      name: 'Class A',
    }));
    await assertFails(setDoc(doc(teacherDb, 'classes', 'class-b'), {
      schoolId: 'school-b',
      name: 'Other school class',
    }));

    const studentDb = tenantContext('student-a', 'student').firestore();
    await assertSucceeds(getDoc(doc(studentDb, 'students', 'student-a')));
    await assertFails(getDoc(doc(studentDb, 'tenants', 'school-b')));
  });

  test('trusted Admin SDK provisioning remains able to create user records', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await assertSucceeds(setDoc(doc(context.firestore(), 'users', 'school-a:provisioned'), {
        email: 'provisioned@example.test',
        schoolId: 'school-a',
        tenantId: 'school-a',
        role: 'teacher',
        roles: ['teacher'],
        platformAdmin: false,
      }));
    });
  });
});

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  describe('Firestore Emulator test prerequisite', () => {
    test.skip('run with firebase emulators:exec --only firestore', () => {});
  });
}