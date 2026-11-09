const fs = require('fs');
const path = require('path');

const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
const describeWithStorageEmulator = storageEmulatorHost ? describe : describe.skip;
let testEnvironment;
let assertFails;
let assertSucceeds;
let initializeTestEnvironment;
let ref;
let uploadBytes;
let getBytes;
let deleteObject;

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

describeWithStorageEmulator('Firebase Storage backend-only access rules', () => {
  beforeAll(async () => {
    ({ assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing'));
    ({ ref, uploadBytes, getBytes, deleteObject } = require('firebase/storage'));
    const separator = storageEmulatorHost.lastIndexOf(':');
    testEnvironment = await initializeTestEnvironment({
      projectId: 'demo-globyedu-security-rules',
      storage: {
        host: storageEmulatorHost.slice(0, separator),
        port: Number(storageEmulatorHost.slice(separator + 1)),
        rules: fs.readFileSync(path.resolve(__dirname, '../../../../storage.rules'), 'utf8'),
      },
    });
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  beforeEach(async () => {
    await testEnvironment.clearStorage();
  });

  test.each(['school_authority', 'teacher', 'student', 'super_admin'])(
    '%s cannot directly read, upload, overwrite, or delete tenant files',
    async (role) => {
      const objectPath = 'tenants/school-a/student-profile/student-a/photo.png';
      const file = new Uint8Array([137, 80, 78, 71]);
      await testEnvironment.withSecurityRulesDisabled(async (context) => {
        await uploadBytes(ref(context.storage(), objectPath), file);
      });

      const storage = authenticatedContext(`${role}-uid`, role).storage();
      const objectRef = ref(storage, objectPath);
      await assertFails(getBytes(objectRef));
      await assertFails(uploadBytes(ref(storage, `tenants/school-a/teacher-profile/photo.png`), file));
      await assertFails(uploadBytes(objectRef, file));
      await assertFails(deleteObject(objectRef));
    }
  );

  test('unauthenticated users cannot access tenant files', async () => {
    const storage = testEnvironment.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(storage, 'tenants/school-a/school-assets/logo.png'), new Uint8Array([1])));
    await assertFails(getBytes(ref(storage, 'tenants/school-a/school-assets/logo.png')));
  });
});

if (!storageEmulatorHost) {
  describe('Firebase Storage Emulator test prerequisite', () => {
    test.skip('run with FIREBASE_STORAGE_EMULATOR_HOST set to an isolated Storage emulator', () => {});
  });
}
