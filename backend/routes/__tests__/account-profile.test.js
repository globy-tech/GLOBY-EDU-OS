const express = require('express');

jest.mock('../../modules/auth/middleware/auth.middleware', () => (req, res, next) => {
  const identities = {
    authority: {
      userId: 'qa-school:authority@example.test',
      roles: ['school_authority'],
      tenantId: 'qa-school',
      schoolId: 'qa-school',
    },
    otherAuthority: {
      userId: 'qa-other:authority@example.test',
      roles: ['school_authority'],
      tenantId: 'qa-other',
      schoolId: 'qa-other',
    },
    platformAdmin: {
      userId: 'platform:admin@example.test',
      roles: ['super_admin'],
      platformAdmin: true,
      tenantId: null,
      schoolId: null,
    },
    tenantAdmin: {
      userId: 'qa-school:authority@example.test',
      roles: ['super_admin'],
      platformAdmin: true,
      tenantId: 'qa-school',
      schoolId: 'qa-school',
    },
  };
  req.user = identities[req.get('x-test-identity')] || identities.authority;
  next();
});

jest.mock('../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../modules/school/fallback.school', () => ({
  loadSchoolData: jest.fn(),
  saveSchoolData: jest.fn(),
}));
jest.mock('../../lib/supabaseClient', () => ({
  uploadSchoolFile: jest.fn(),
  deleteSchoolFile: jest.fn(),
  createSchoolFileSignedUrl: jest.fn(),
  isR2Configured: jest.fn(() => true),
  getR2ConfigurationStatus: () => ({ missingVariables: [], invalidVariables: [] }),
}));

const { loadSchoolData, saveSchoolData } = require('../../modules/school/fallback.school');
const storage = require('../../lib/supabaseClient');
const accountProfileRoutes = require('../account-profile');
jest.setTimeout(15000);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const originalRenderServiceId = process.env.RENDER_SERVICE_ID;
let server;
let baseUrl;
let schools;

beforeAll(async () => {
  process.env.GLOBY_QA_MODE = 'true';
  process.env.NODE_ENV = 'test';
  const app = express();
  app.use('/account-profile', accountProfileRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/account-profile/photo`;
});

beforeEach(() => {
  schools = [
    {
      schoolId: 'qa-school',
      users: [
        { username: 'authority@example.test', email: 'authority@example.test', role: 'school_authority', status: 'active' },
      ],
    },
    {
      schoolId: 'platform',
      users: [
        { username: 'admin@example.test', email: 'admin@example.test', role: 'super_admin', roles: ['super_admin'], platformAdmin: true, status: 'active' },
      ],
    },
  ];
  loadSchoolData.mockReturnValue(schools);
  loadSchoolData.mockClear();
  saveSchoolData.mockClear();
  storage.uploadSchoolFile.mockClear();
  storage.deleteSchoolFile.mockClear();
  storage.uploadSchoolFile.mockResolvedValue({ storage: 'r2', eTag: '"profile-photo-etag"' });
  storage.deleteSchoolFile.mockResolvedValue(true);
  storage.isR2Configured.mockReturnValue(true);
  storage.createSchoolFileSignedUrl.mockImplementation(async (path) => `https://storage.example/${path}`);
});

afterAll(async () => {
  const closeServer = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  await closeServer;
  delete process.env.GLOBY_QA_MODE;
  if (originalRenderServiceId === undefined) delete process.env.RENDER_SERVICE_ID;
  else process.env.RENDER_SERVICE_ID = originalRenderServiceId;
});

describe('authenticated account profile photos', () => {
  test('saves an authority photo to the authenticated tenant account and retrieves it', async () => {
    const uploaded = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG,
    });

    expect(uploaded.status).toBe(201);
    const uploadResult = await uploaded.json();
    expect(uploadResult.path).toMatch(/^account-profile\/school_authority\/[a-f0-9]{64}\//);
    expect(schools[0].users[0].profilePhotoPath).toBe(uploadResult.path);
    expect(saveSchoolData).toHaveBeenCalledWith(schools);

    const retrieved = await fetch(baseUrl);
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toMatchObject({ status: 'ok', path: uploadResult.path, url: `https://storage.example/${uploadResult.path}` });
  });

  test('removes a newly uploaded photo if its download link cannot be prepared before saving the profile reference', async () => {
    storage.createSchoolFileSignedUrl.mockRejectedValue(new Error('Signing failed'));

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: 'error',
      message: 'Unable to create a download link for the profile photo.',
    });
    expect(schools[0].users[0].profilePhotoPath).toBeUndefined();
    expect(storage.deleteSchoolFile).toHaveBeenCalledWith(
      expect.stringMatching(/^account-profile\/school_authority\/[a-f0-9]{64}\//),
      { storage: 'r2', eTag: '"profile-photo-etag"' },
    );
    expect(saveSchoolData).not.toHaveBeenCalled();
  });

  test('allows a tenantless platform admin and rejects a tenant-bound admin', async () => {
    const allowed = await fetch(baseUrl, { headers: { 'x-test-identity': 'platformAdmin' } });
    expect(allowed.status).toBe(200);

    const denied = await fetch(baseUrl, { headers: { 'x-test-identity': 'tenantAdmin' } });
    expect(denied.status).toBe(403);
  });

  test('saves and reloads a platform admin photo without tenant association', async () => {
    const uploaded = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'x-test-identity': 'platformAdmin', 'Content-Type': 'image/png' },
      body: PNG,
    });

    expect(uploaded.status).toBe(201);
    const result = await uploaded.json();
    expect(result.path).toMatch(/^account-profile\/super_admin\/[a-f0-9]{64}\//);
    expect(schools[1].users[0].profilePhotoPath).toBe(result.path);

    const retrieved = await fetch(baseUrl, { headers: { 'x-test-identity': 'platformAdmin' } });
    expect(retrieved.status).toBe(200);
    expect((await retrieved.json()).path).toBe(result.path);
  });

  test('does not allow another authority identity to resolve a different tenant profile', async () => {
    const denied = await fetch(baseUrl, { headers: { 'x-test-identity': 'otherAuthority' } });
    expect(denied.status).toBe(403);
  });

  test('rejects missing and invalid image uploads without changing the saved photo', async () => {
    const missing = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'image/png' } });
    expect(missing.status).toBe(400);

    const invalid = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.from('not an image'),
    });
    expect(invalid.status).toBe(400);
    expect(saveSchoolData).not.toHaveBeenCalled();
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('rejects local QA profiles and storage when running on Render without R2', async () => {
    const previousRenderServiceId = process.env.RENDER_SERVICE_ID;
    process.env.RENDER_SERVICE_ID = 'render-qa-test';
    storage.isR2Configured.mockReturnValue(false);

    try {
      const response = await fetch(baseUrl);
      expect(response.status).toBe(403);
      expect(loadSchoolData).not.toHaveBeenCalled();
      expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
    } finally {
      if (previousRenderServiceId === undefined) delete process.env.RENDER_SERVICE_ID;
      else process.env.RENDER_SERVICE_ID = previousRenderServiceId;
    }
  });
});
