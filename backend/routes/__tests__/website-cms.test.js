const express = require('express');

const mockSettingsDocuments = new Map();
const mockStorageObjects = new Map();
let mockFailSettingsWrite = false;
let mockFailLogoUpload = false;
let mockFailLogoRead = false;
let mockR2Configured = true;

function makeDocumentReference(collection, id) {
  const key = `${collection}:${id}`;
  return {
    get: async () => {
      const value = mockSettingsDocuments.get(key);
      return {
        exists: value !== undefined,
        id: String(id),
        data: () => value === undefined ? undefined : structuredClone(value),
      };
    },
    set: async (data, options = {}) => {
      if (mockFailSettingsWrite && collection === 'platformSettings') {
        mockFailSettingsWrite = false;
        throw new Error('in-memory Firestore write failed');
      }
      const current = mockSettingsDocuments.get(key) || {};
      mockSettingsDocuments.set(key, options.merge === false ? structuredClone(data) : { ...current, ...structuredClone(data) });
    },
  };
}

const mockFirestore = {
  collection: (name) => ({ doc: (id) => makeDocumentReference(name, id) }),
};

const mockStorageBucket = {
  file: (filePath) => ({
    save: async (body, options) => {
      if (mockFailLogoUpload) {
        mockFailLogoUpload = false;
        throw new Error('in-memory storage write failed');
      }
      mockStorageObjects.set(filePath, { body: Buffer.from(body), options });
    },
    getSignedUrl: async () => {
      if (mockFailLogoRead || !mockStorageObjects.has(filePath)) throw new Error('logo object is unavailable');
      return [`https://storage.example.test/${filePath}?signature=synthetic`];
    },
  }),
};

jest.mock('../../modules/auth/middleware/auth.middleware', () => (req, res, next) => {
  const identity = req.get('authorization');
  if (!identity) return res.status(401).json({ status: 'error', message: 'Authorization required.' });
  if (identity === 'Bearer platform-admin') {
    req.user = { userId: 'platform-admin', roles: ['super_admin'], platformAdmin: true, tenantId: null, schoolId: null };
  } else if (identity === 'Bearer tenant-admin') {
    req.user = { userId: 'school-a:admin', roles: ['super_admin'], platformAdmin: true, tenantId: 'school-a', schoolId: 'school-a' };
  } else {
    req.user = { userId: 'school-a:teacher', roles: ['teacher'], tenantId: 'school-a', schoolId: 'school-a' };
  }
  return next();
});

jest.mock('../../firebase.data', () => ({
  isFirebaseDataConfigured: () => true,
  getFirestore: () => mockFirestore,
  getStorageBucket: () => mockStorageBucket,
}));

jest.mock('../../lib/supabaseClient', () => ({
  uploadSchoolFile: jest.fn(async (filePath, body, options) => {
    if (mockFailLogoUpload) {
      mockFailLogoUpload = false;
      throw new Error('in-memory R2 write failed');
    }
    mockStorageObjects.set(filePath, { body: Buffer.from(body), options });
    return filePath;
  }),
  createSchoolFileSignedUrl: jest.fn(async (filePath) => {
    if (mockFailLogoRead || !mockStorageObjects.has(filePath)) throw new Error('logo object is unavailable');
    return `https://storage.example.test/${filePath}?signature=synthetic`;
  }),
  isR2Configured: () => mockR2Configured,
  getR2ConfigurationStatus: () => ({ configured: mockR2Configured, missingVariables: [], invalidVariables: [] }),
}));

const storage = require('../../lib/supabaseClient');
const websiteCmsRoutes = require('../website-cms');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
let server;
let baseUrl;
let originalNodeEnv;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/website-cms', websiteCmsRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/website-cms`;
});

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  mockSettingsDocuments.clear();
  mockStorageObjects.clear();
  mockFailSettingsWrite = false;
  mockFailLogoUpload = false;
  mockFailLogoRead = false;
  mockR2Configured = true;
  jest.clearAllMocks();
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

async function request(path = '/', options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof Buffer ? { 'Content-Type': 'image/png' } : {}),
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

const adminHeaders = { Authorization: 'Bearer platform-admin' };

describe('shared public Website CMS', () => {
  test('serves only whitelisted published settings and omits storage paths', async () => {
    mockSettingsDocuments.set('platformSettings:website-cms', {
      published: true,
      updatedBy: 'internal-id',
      settings: {
        companyName: 'Shared School Platform',
        heroTitle: 'A shared title',
        contactEmail: 'contact@example.test',
        logoPath: 'website-branding/00000000-0000-4000-8000-000000000001.png',
        privateKey: 'must-not-leak',
      },
    });

    const { response, body } = await request();

    expect(response.status).toBe(200);
    expect(body.settings).toMatchObject({ companyName: 'Shared School Platform', heroTitle: 'A shared title' });
    expect(body.settings.logoUrl).toBe('/src/assets/images/ui/globyedu-logo.jpg');
    expect(body.settings.address).toBe('');
    expect(body.settings).not.toHaveProperty('logoPath');
    expect(body.settings).not.toHaveProperty('updatedBy');
    expect(body.settings).not.toHaveProperty('privateKey');
  });

  test('publishes settings to shared Firestore state visible to a separate public request', async () => {
    const { response: saveResponse, body: saveBody } = await request('/', {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: {
        companyName: 'GlobyEdu Shared',
        heroTitle: 'Shared launch title',
        contactEmail: 'hello@example.test',
        themeColor: '#123abc',
      } }),
    });

    expect(saveResponse.status).toBe(200);
    expect(mockSettingsDocuments.get('platformSettings:website-cms')).toMatchObject({
      published: true,
      updatedBy: 'platform-admin',
      settings: { companyName: 'GlobyEdu Shared', heroTitle: 'Shared launch title' },
    });

    const { body: publicBody } = await request();
    expect(publicBody.settings).toMatchObject({ companyName: 'GlobyEdu Shared', heroTitle: 'Shared launch title' });
    expect(publicBody.settings).not.toHaveProperty('logoPath');
    expect(saveBody.settings).toHaveProperty('logoPath', '');
  });

  test('allows only a tenantless platform administrator to access CMS writes and admin reads', async () => {
    const tenantWrite = await request('/', {
      method: 'PUT',
      headers: { Authorization: 'Bearer tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { companyName: 'Not allowed' } }),
    });
    const teacherUpload = await request('/branding-logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer teacher' },
      body: PNG,
    });
    const publicAdminRead = await request('/admin');
    const trueAdminRead = await request('/admin', { headers: adminHeaders });

    expect(tenantWrite.response.status).toBe(403);
    expect(teacherUpload.response.status).toBe(403);
    expect(publicAdminRead.response.status).toBe(401);
    expect(trueAdminRead.response.status).toBe(200);
    expect(mockSettingsDocuments.size).toBe(0);
    expect(storage.uploadSchoolFile).not.toHaveBeenCalled();
  });

  test('uploads a server-named global logo to R2 and returns a fresh public signed URL after publication', async () => {
    process.env.NODE_ENV = 'production';
    const { response: uploadResponse, body: uploadBody } = await request('/branding-logo', {
      method: 'POST',
      headers: adminHeaders,
      body: PNG,
    });

    expect(uploadResponse.status).toBe(201);
    expect(uploadBody.path).toMatch(/^website-branding\/[0-9a-f-]+\.png$/i);
    expect(storage.uploadSchoolFile).toHaveBeenCalledWith(uploadBody.path, PNG, {
      contentType: 'image/png',
      upsert: false,
    });

    const saveResult = await request('/', {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { logoPath: uploadBody.path } }),
    });
    expect(saveResult.response.status).toBe(200);

    const firstBrowser = await request();
    const secondBrowser = await request();
    expect(firstBrowser.body.settings.logoUrl).toBe(uploadBody.url);
    expect(secondBrowser.body.settings.logoUrl).toBe(uploadBody.url);
    expect(firstBrowser.body.settings).not.toHaveProperty('logoPath');
  });

  test('rejects invalid images and leaves published settings unchanged when upload fails', async () => {
    mockSettingsDocuments.set('platformSettings:website-cms', {
      published: true,
      settings: { companyName: 'Before failure' },
    });

    const invalid = await request('/branding-logo', {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'image/png' },
      body: Buffer.from('not an image'),
    });
    mockFailLogoUpload = true;
    const failed = await request('/branding-logo', { method: 'POST', headers: adminHeaders, body: PNG });

    expect(invalid.response.status).toBe(400);
    expect(failed.response.status).toBe(502);
    expect(mockSettingsDocuments.get('platformSettings:website-cms').settings.companyName).toBe('Before failure');
  });

  test('keeps the previous published settings when a Firestore write fails', async () => {
    mockSettingsDocuments.set('platformSettings:website-cms', {
      published: true,
      settings: { companyName: 'Previously published' },
    });
    mockFailSettingsWrite = true;

    const { response, body } = await request('/', {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { companyName: 'New value' } }),
    });

    expect(response.status).toBe(503);
    expect(body.message).toMatch(/could not be saved/i);
    expect(mockSettingsDocuments.get('platformSettings:website-cms').settings.companyName).toBe('Previously published');
  });

  test('falls back safely when the published logo object is missing', async () => {
    mockSettingsDocuments.set('platformSettings:website-cms', {
      published: true,
      settings: {
        companyName: 'Published without file',
        logoPath: 'website-branding/00000000-0000-4000-8000-000000000002.png',
      },
    });

    const { response, body } = await request();

    expect(response.status).toBe(200);
    expect(body.settings.logoUrl).toBe('/src/assets/images/ui/globyedu-logo.jpg');
  });
});