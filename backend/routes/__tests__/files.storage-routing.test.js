const express = require('express');
jest.setTimeout(30000);

jest.mock('../../modules/auth/middleware/auth.middleware', () => (req, res, next) => {
  req.user = global.__uploadUser || { tenantId: 'school-a', roles: ['school_authority'] };
  next();
});

jest.mock('../../firebase.data', () => ({
  isFirebaseDataConfigured: jest.fn(() => true),
  getStorageBucket: jest.fn(),
}));

jest.mock('../../firebase.core', () => ({
  getSchoolAggregate: jest.fn(async (schoolId) => global.__uploadTenant || {
    schoolId,
    schoolStatus: 'active',
    subscriptionStatus: 'active',
  }),
}));

jest.mock('../../modules/school/school.service', () => ({
  resolveSchoolLifecycleStatus: jest.fn((school) => school),
  isSchoolAccessAllowed: jest.fn((school) => !school.expiresAt || new Date(school.expiresAt).getTime() > Date.now()),
  getSchoolBySchoolId: jest.fn(async (schoolId) => (
    global.__uploadSchool?.schoolId === schoolId ? global.__uploadSchool : null
  )),
  getTeacherSchoolView: jest.fn((school, user) => {
    const teacher = (school.teachers || []).find((record) =>
      [record.teacherId, record.id, record.username, record.email].some((value) =>
        String(value || '').toLowerCase() === String(user.username || user.userId || '').split(':').pop().toLowerCase()
      )
    );
    const assigned = new Set((teacher?.assignedClasses || []).map((value) => String(value).toLowerCase()));
    return {
      students: (school.students || []).filter((record) => assigned.has(String(record.classId || record.className || '').toLowerCase())),
    };
  }),
  updateSchool: jest.fn(async (id, updates) => Object.assign(global.__uploadSchool, updates)),
  updateEntity: jest.fn(async (schoolId, entityType, identifier, updates) => {
    const list = entityType === 'students' ? global.__uploadSchool.students : global.__uploadSchool.teachers;
    const record = list.find((entry) => [entry.studentId, entry.teacherId, entry.id, entry.email, entry.username]
      .some((value) => String(value || '').toLowerCase() === String(identifier).toLowerCase()));
    if (!record) throw new Error('Entity not found');
    Object.assign(record, updates);
    return record;
  }),
  updateTeacherWorkspace: jest.fn((school, user, updates) => {
    const teacher = (school.teachers || []).find((record) =>
      [record.teacherId, record.id, record.username, record.email].some((value) =>
        String(value || '').toLowerCase() === String(user.username || user.userId || '').split(':').pop().toLowerCase()
      )
    );
    if (!teacher) throw new Error('Teacher profile not found');
    Object.assign(teacher, updates.teacherProfile);
    return school;
  }),
}));

jest.mock('../../lib/supabaseClient', () => ({
  uploadSchoolFile: jest.fn(async () => {}),
  createSchoolFileSignedUrl: jest.fn(async () => 'https://signed.example.test/file'),
  isR2Configured: jest.fn(() => true),
  getR2ConfigurationStatus: jest.fn(() => ({ configured: true, missingVariables: [], invalidVariables: [] })),
  getSchoolFilePublicUrl: jest.fn(() => null),
}));

const firebaseData = require('../../firebase.data');
const storage = require('../../lib/supabaseClient');
const schoolService = require('../../modules/school/school.service');
const fileRoutes = require('../files');
const firebaseSave = jest.fn(async () => {});
const firebaseFile = {
  save: firebaseSave,
  getSignedUrl: jest.fn(async () => ['https://firebase-signed.example.test/file']),
};

describe('production file storage routing', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    jest.clearAllMocks();
    firebaseData.isFirebaseDataConfigured.mockReturnValue(true);
    firebaseData.getStorageBucket.mockReturnValue({
      file: jest.fn(() => firebaseFile),
    });
    firebaseSave.mockClear();
    firebaseFile.getSignedUrl.mockClear();
    storage.isR2Configured.mockReturnValue(true);
    storage.getSchoolFilePublicUrl.mockReturnValue(null);
    global.__uploadSchool = {
      id: 'school-a',
      schoolId: 'school-a',
      logoPath: 'school-logo/photo.png',
      students: [{
        id: 'STU-1',
        studentId: 'STU-1',
        email: 'student@school-a.example.test',
        classId: 'class-a',
        profilePhotoPath: 'student-profile/photo.png',
      }],
      teachers: [{
        id: 'TCH-1',
        teacherId: 'TCH-1',
        email: 'teacher@school-a.example.test',
        assignedClasses: ['class-a'],
        profilePhotoPath: 'teacher-profile/photo.png',
      }],
      classes: [{ classId: 'class-a', teacherId: 'TCH-1' }],
    };
    schoolService.getSchoolBySchoolId.mockClear();
    schoolService.updateSchool.mockClear();
    schoolService.updateEntity.mockClear();
    schoolService.updateTeacherWorkspace.mockClear();
    delete global.__uploadUser;
    delete global.__uploadTenant;
    delete global.__disableAutoUploadOwner;
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  async function runRequest(method, url, body, contentType = 'image/png') {
    if (method === 'POST' && url.startsWith('/files/upload')) {
      const parsed = new URL(url, 'http://localhost');
      if (!parsed.searchParams.has('ownerType') && !global.__disableAutoUploadOwner) {
        const filename = parsed.searchParams.get('filename') || '';
        if (filename.startsWith('student-profile/')) {
          parsed.searchParams.set('ownerType', 'student');
          parsed.searchParams.set('ownerId', 'STU-1');
          parsed.searchParams.set('ownerField', 'profilePhotoPath');
        } else if (filename.startsWith('teacher-profile/')) {
          parsed.searchParams.set('ownerType', 'teacher');
          parsed.searchParams.set('ownerId', 'TCH-1');
          parsed.searchParams.set('ownerField', 'profilePhotoPath');
        } else {
          parsed.searchParams.set('ownerType', 'school');
          parsed.searchParams.set('ownerId', global.__uploadUser?.tenantId || global.__uploadUser?.schoolId || 'school-a');
          parsed.searchParams.set('ownerField', 'logoPath');
        }
        url = `${parsed.pathname}${parsed.search}`;
      }
    }
    const app = express();
    app.use('/files', fileRoutes);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method,
        headers: method === 'POST'
          ? { 'content-type': contentType, connection: 'close' }
          : { connection: 'close' },
        body,
      });
      const responseBody = await response.arrayBuffer();
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }

  test('uploads to R2 without requiring a persistent public URL', async () => {
    const response = await runRequest('POST', '/files/upload?filename=school-logo/photo.png', Buffer.from('image'));
    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith('school-a/school-logo/photo.png', expect.any(Buffer), expect.objectContaining({
      contentType: 'image/png',
      upsert: false,
    }));
    expect(firebaseData.getStorageBucket).not.toHaveBeenCalled();
  });

  test('uploads an authorized tenant file to R2 when production configuration is valid', async () => {
    storage.getSchoolFilePublicUrl.mockReturnValue('https://files.example.test/school-a/school-logo/photo.png');

    const response = await runRequest('POST', '/files/upload?filename=school-logo/photo.png', Buffer.from('image'));

    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith('school-a/school-logo/photo.png', expect.any(Buffer), expect.objectContaining({
      contentType: 'image/png',
      upsert: false,
    }));
    expect(firebaseData.getStorageBucket).not.toHaveBeenCalled();
  });

  test('uses a create-only generation precondition for Firebase Storage uploads', async () => {
    process.env.NODE_ENV = 'test';
    const response = await runRequest('POST', '/files/upload?filename=school-logo/photo.png', Buffer.from('image'));

    expect(response.status).toBe(201);
    expect(firebaseSave).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      preconditionOpts: { ifGenerationMatch: 0 },
    }));
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('allows signed-url R2 uploads when a public URL has not yet been configured', async () => {
    storage.getSchoolFilePublicUrl.mockReturnValue(null);

    const response = await runRequest('POST', '/files/upload?filename=student-profile/photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith('school-a/student-profile/photo.png', expect.any(Buffer), expect.any(Object));
  });

  test('allows a valid profile image for an authorized same-tenant user', async () => {
    storage.getSchoolFilePublicUrl.mockReturnValue('https://files.example.test/school-a/student-profile/photo.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const response = await runRequest('POST', '/files/upload?filename=student-profile/photo.png', png);

    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith('school-a/student-profile/photo.png', png, expect.any(Object));
  });

  test('allows profile images larger than 2 MB up to the shared 20 MB limit', async () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const png = Buffer.concat([signature, Buffer.alloc(3 * 1024 * 1024)]);

    const response = await runRequest('POST', '/files/upload?filename=student-profile/photo.png', png);

    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith('school-a/student-profile/photo.png', png, expect.any(Object));
  });

  test('rejects unsupported profile image content types', async () => {
    const response = await runRequest('POST', '/files/upload?filename=student-profile/photo.png', Buffer.from('%PDF'), 'application/pdf');

    expect(response.status).toBe(400);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('rejects oversized profile images before reaching storage', async () => {
    const png = Buffer.alloc(20 * 1024 * 1024 + 1, 0x00);

    const response = await runRequest('POST', '/files/upload?filename=student-profile/photo.png', png);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ status: 'error', message: 'This file is too large to upload. Choose a smaller file.' });
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('rejects a student attempting to upload a teacher profile photo', async () => {
    global.__uploadUser = { tenantId: 'school-a', roles: ['student'] };

    const response = await runRequest('POST', '/files/upload?filename=teacher-profile/photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    expect(response.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('allows a student to upload only to their own profile record', async () => {
    global.__uploadUser = { tenantId: 'school-a', username: 'STU-1', roles: ['student'] };
    const response = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/new-photo.png&ownerType=student&ownerId=STU-1&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledTimes(1);
    expect(schoolService.updateEntity).toHaveBeenCalledWith(
      'school-a',
      'students',
      'STU-1',
      { profilePhotoPath: 'student-profile/new-photo.png' },
      global.__uploadUser
    );
  });

  test('allows teachers to upload to their own teacher profile only', async () => {
    global.__uploadUser = { tenantId: 'school-a', username: 'TCH-1', roles: ['teacher'] };
    const response = await runRequest(
      'POST',
      '/files/upload?filename=teacher-profile/new-photo.png&ownerType=teacher&ownerId=self&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    expect(response.status).toBe(201);
    expect(schoolService.updateTeacherWorkspace).toHaveBeenCalledWith(
      global.__uploadSchool,
      global.__uploadUser,
      { teacherProfile: { profilePhotoPath: 'teacher-profile/new-photo.png' } }
    );
  });

  test('rejects a student uploading to another same-tenant student record before storage', async () => {
    global.__uploadUser = { tenantId: 'school-a', username: 'STU-1', roles: ['student'] };
    global.__uploadSchool.students.push({
      id: 'STU-2',
      studentId: 'STU-2',
      email: 'other@school-a.example.test',
      classId: 'class-a',
    });
    const response = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/other.png&ownerType=student&ownerId=STU-2&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    expect(response.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
    expect(schoolService.updateEntity).not.toHaveBeenCalled();
  });

  test('rejects a profile upload without an explicit owner target before storage', async () => {
    global.__disableAutoUploadOwner = true;
    const response = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/unowned.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    expect(response.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
    expect(firebaseSave).not.toHaveBeenCalled();
  });

  test('allows teacher photo uploads only for students in assigned classes', async () => {
    global.__uploadUser = { tenantId: 'school-a', username: 'TCH-1', roles: ['teacher'] };
    const url = '/files/upload?filename=student-profile/class-photo.png&ownerType=student&ownerId=STU-1&ownerField=profilePhotoPath';
    const allowedResponse = await runRequest('POST', url, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(allowedResponse.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    global.__uploadSchool.students[0].classId = 'class-b';
    const deniedResponse = await runRequest('POST', url, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(deniedResponse.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('rejects unknown and ambiguous profile records before storage', async () => {
    const unknownResponse = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/unknown.png&ownerType=student&ownerId=UNKNOWN&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(unknownResponse.status).toBe(403);

    global.__uploadSchool.students.push({ ...global.__uploadSchool.students[0] });
    const ambiguousResponse = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/ambiguous.png&ownerType=student&ownerId=STU-1&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(ambiguousResponse.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('rejects upload paths already linked to a different record before storage', async () => {
    global.__uploadSchool.students.push({
      id: 'STU-2',
      studentId: 'STU-2',
      email: 'other@school-a.example.test',
      classId: 'class-a',
    });
    const response = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/photo.png&ownerType=student&ownerId=STU-2&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    expect(response.status).toBe(409);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('rejects cross-tenant and wrong-role upload targets before storage', async () => {
    global.__uploadUser = { tenantId: 'school-b', username: 'TCH-1', roles: ['teacher'] };
    const crossTenantResponse = await runRequest(
      'POST',
      '/files/upload?filename=student-profile/cross-tenant.png&ownerType=student&ownerId=STU-1&ownerField=profilePhotoPath',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(crossTenantResponse.status).toBe(403);

    global.__uploadUser = { tenantId: 'school-a', username: 'STU-1', roles: ['student'] };
    const schoolAssetResponse = await runRequest(
      'POST',
      '/files/upload?filename=school-logo/unauthorized.png&ownerType=school&ownerId=school-a&ownerField=logoPath',
      Buffer.from('image')
    );
    expect(schoolAssetResponse.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('associates an authorized school asset with its server-side school record', async () => {
    const response = await runRequest(
      'POST',
      '/files/upload?filename=school-cover/cover.png&ownerType=school&ownerId=school-a&ownerField=coverImagePath',
      Buffer.from('image')
    );

    expect(response.status).toBe(201);
    expect(global.__uploadSchool.coverImagePath).toBe('school-cover/cover.png');
    expect(schoolService.updateSchool).toHaveBeenCalledWith('school-a', {
      coverImagePath: 'school-cover/cover.png',
    });
  });

  test('allows tenant members to view school branding but not authority-only stamps or signatures', async () => {
    global.__uploadSchool.coverImagePath = 'school-cover/cover.png';
    global.__uploadSchool.stampPath = 'school-assets/stamp.png';
    global.__uploadUser = { tenantId: 'school-a', username: 'STU-1', roles: ['student'] };

    const branding = await runRequest('GET', '/files/school-cover/cover.png');
    const stamp = await runRequest('GET', '/files/school-assets/stamp.png');

    expect(branding.status).toBe(200);
    expect(stamp.status).toBe(403);
    expect(storage.createSchoolFileSignedUrl).toHaveBeenCalledTimes(1);
  });

  test('scopes upload paths to the authenticated tenant, ignoring a caller-supplied school ID', async () => {
    global.__uploadUser = { tenantId: 'school-b', roles: ['school_authority'] };
    global.__uploadSchool.id = 'school-b';
    global.__uploadSchool.schoolId = 'school-b';
    storage.getSchoolFilePublicUrl.mockReturnValue('https://files.example.test/school-b/school-logo/photo.png');

    const response = await runRequest('POST', '/files/upload?schoolId=school-a&filename=school-logo/photo.png', Buffer.from('image'));

    expect(response.status).toBe(201);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith('school-b/school-logo/photo.png', expect.any(Buffer), expect.any(Object));
  });

  test('returns storage failure instead of reporting a successful upload', async () => {
    storage.getSchoolFilePublicUrl.mockReturnValue('https://files.example.test/school-a/school-logo/photo.png');
    storage.uploadSchoolFile.mockRejectedValue(new Error('R2 write failed'));

    const response = await runRequest('POST', '/files/upload?filename=school-logo/photo.png', Buffer.from('image'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.status).toBe('error');
  });

  test('reports missing R2 variable names without exposing configuration values', async () => {
    storage.isR2Configured.mockReturnValue(false);
    storage.getR2ConfigurationStatus.mockReturnValue({
      configured: false,
      missingVariables: ['CLOUDFLARE_R2_SECRET_ACCESS_KEY'],
      invalidVariables: [],
    });

    const response = await runRequest('POST', '/files/upload?filename=school-logo/photo.png', Buffer.from('image'));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.message).toContain('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    expect(payload.message).not.toContain('secret-test');
  });

  test('does not use Firebase Storage for production retrieval when R2 is configured', async () => {
    const response = await runRequest('GET', '/files/student-profile/photo.png');

    expect(response.status).toBe(200);
    expect(firebaseData.getStorageBucket).not.toHaveBeenCalled();
    expect(storage.createSchoolFileSignedUrl).toHaveBeenCalledWith('school-a/student-profile/photo.png', 3600);
  });

  test('rejects unknown, ambiguous, non-owner, and out-of-scope signed URLs before signing', async () => {
    const unknown = await runRequest('GET', '/files/unlinked/private.pdf');
    expect(unknown.status).toBe(403);

    global.__uploadUser = { tenantId: 'school-a', username: 'STU-2', roles: ['student'] };
    const nonOwner = await runRequest('GET', '/files/student-profile/photo.png');
    expect(nonOwner.status).toBe(403);

    global.__uploadUser = { tenantId: 'school-a', username: 'TCH-1', roles: ['teacher'] };
    const assigned = await runRequest('GET', '/files/student-profile/photo.png');
    expect(assigned.status).toBe(200);

    global.__uploadSchool.students[0].classId = 'class-b';
    const wrongClass = await runRequest('GET', '/files/student-profile/photo.png');
    expect(wrongClass.status).toBe(403);

    global.__uploadSchool.students.push({ ...global.__uploadSchool.students[0] });
    const ambiguous = await runRequest('GET', '/files/student-profile/photo.png');
    expect(ambiguous.status).toBe(403);
    expect(storage.createSchoolFileSignedUrl).toHaveBeenCalledTimes(1);
  });

  test('denies same-tenant non-owner and cross-tenant signed URL access', async () => {
    global.__uploadUser = { tenantId: 'school-a', username: 'TCH-2', roles: ['teacher'] };
    const sameTenant = await runRequest('GET', '/files/teacher-profile/photo.png');
    expect(sameTenant.status).toBe(403);

    global.__uploadUser = { tenantId: 'school-b', username: 'TCH-1', roles: ['teacher'] };
    const crossTenant = await runRequest('GET', '/files/teacher-profile/photo.png');
    expect(crossTenant.status).toBe(403);
    expect(storage.createSchoolFileSignedUrl).not.toHaveBeenCalled();
  });

  test('never returns a permanent public URL for a tenant file', async () => {
    global.__uploadSchool.logoPath = 'students/private-report.pdf';
    storage.getSchoolFilePublicUrl.mockReturnValue('https://files.example.test/school-a/students/private-report.pdf');
    storage.createSchoolFileSignedUrl.mockResolvedValue('https://signed.example.test/private-report');

    const response = await runRequest('GET', '/files/students/private-report.pdf');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      url: 'https://signed.example.test/private-report',
      expiresIn: 3600,
      persistent: false,
    });
    expect(storage.createSchoolFileSignedUrl).toHaveBeenCalledWith('school-a/students/private-report.pdf', 3600);
  });

  test.each([
    ['1', 300],
    ['299', 300],
    ['300', 300],
    ['86400', 3600],
  ])('reports the effective signed URL expiry for expiresIn=%s', async (requestedExpiry, effectiveExpiry) => {
    global.__uploadSchool.logoPath = 'students/private-report.pdf';
    const response = await runRequest('GET', `/files/students/private-report.pdf?expiresIn=${requestedExpiry}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', expiresIn: effectiveExpiry });
    expect(storage.createSchoolFileSignedUrl).toHaveBeenCalledWith('school-a/students/private-report.pdf', effectiveExpiry);
  });

  test('fails closed when R2 is unavailable even if Firebase Storage is configured', async () => {
    storage.isR2Configured.mockReturnValue(false);

    const response = await runRequest('GET', '/files/student-profile/photo.png');

    expect(response.status).toBe(503);
    expect(firebaseData.getStorageBucket).not.toHaveBeenCalled();
  });

  test('blocks file upload and retrieval after the tenant subscription expires', async () => {
    global.__uploadTenant = {
      schoolId: 'school-a',
      schoolStatus: 'active',
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };

    const uploadResponse = await runRequest('POST', '/files/upload?filename=school-logo/photo.png', Buffer.from('image'));
    const retrievalResponse = await runRequest('GET', '/files/student-profile/photo.png');

    expect(uploadResponse.status).toBe(403);
    expect(retrievalResponse.status).toBe(403);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
    expect(storage.createSchoolFileSignedUrl).not.toHaveBeenCalled();
  });
});