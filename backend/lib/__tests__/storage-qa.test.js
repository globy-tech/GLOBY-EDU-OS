const fs = require('fs');
const os = require('os');
const path = require('path');

describe('isolated QA file storage', () => {
  const qaHome = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-profile-photo-qa-'));
  const originalEnvironment = {
    qaMode: process.env.GLOBY_QA_MODE,
    qaHome: process.env.GLOBY_QA_HOME,
    renderServiceId: process.env.RENDER_SERVICE_ID,
    r2AccountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    r2Endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
    r2AccessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    r2Bucket: process.env.CLOUDFLARE_R2_BUCKET,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  let storage;

  beforeAll(() => {
    process.env.GLOBY_QA_MODE = 'true';
    process.env.GLOBY_QA_HOME = qaHome;
    for (const key of [
      'CLOUDFLARE_R2_ACCOUNT_ID',
      'CLOUDFLARE_R2_ENDPOINT',
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
      'CLOUDFLARE_R2_BUCKET',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]) delete process.env[key];
    storage = require('../supabaseClient');
  });

  afterAll(() => {
    for (const [key, value] of Object.entries({
      GLOBY_QA_MODE: originalEnvironment.qaMode,
      GLOBY_QA_HOME: originalEnvironment.qaHome,
      RENDER_SERVICE_ID: originalEnvironment.renderServiceId,
      CLOUDFLARE_R2_ACCOUNT_ID: originalEnvironment.r2AccountId,
      CLOUDFLARE_R2_ENDPOINT: originalEnvironment.r2Endpoint,
      CLOUDFLARE_R2_ACCESS_KEY_ID: originalEnvironment.r2AccessKeyId,
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: originalEnvironment.r2SecretAccessKey,
      CLOUDFLARE_R2_BUCKET: originalEnvironment.r2Bucket,
      SUPABASE_URL: originalEnvironment.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: originalEnvironment.supabaseServiceRoleKey,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(qaHome, { recursive: true, force: true });
  });

  test('saves and retrieves a profile image only under the isolated QA home', async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const relativePath = 'GLB-2026-00001/teacher-profile/photo.png';

    await expect(storage.uploadSchoolFile(relativePath, image, { contentType: 'image/png' }))
      .resolves.toBe(relativePath);
    const signedUrl = await storage.createSchoolFileSignedUrl(relativePath);
    const download = await storage.downloadSchoolFile(relativePath);

    expect(signedUrl).toBe(`data:image/png;base64,${image.toString('base64')}`);
    expect(download).toEqual(image);
    expect(fs.readFileSync(path.join(qaHome, 'files', ...relativePath.split('/')))).toEqual(image);
  });

  test('rejects path traversal and does not overwrite existing QA files by default', async () => {
    await expect(storage.uploadSchoolFile('../outside.png', Buffer.from('blocked')))
      .rejects.toThrow('Invalid isolated QA file path.');

    const relativePath = 'GLB-2026-00001/student-profile/photo.png';
    await storage.uploadSchoolFile(relativePath, Buffer.from('original'));
    await expect(storage.uploadSchoolFile(relativePath, Buffer.from('replacement')))
      .rejects.toMatchObject({ code: 'EEXIST' });
    await expect(storage.downloadSchoolFile(relativePath)).resolves.toEqual(Buffer.from('original'));
  });

  test('does not use isolated QA files when running on Render', async () => {
    const previousRenderServiceId = process.env.RENDER_SERVICE_ID;
    process.env.RENDER_SERVICE_ID = 'render-qa-test';
    const relativePath = 'GLB-2026-00001/student-profile/render-photo.png';

    try {
    await expect(storage.uploadSchoolFile(relativePath, Buffer.from('image')))
      .rejects.toThrow('Supabase is not configured.');
    expect(fs.existsSync(path.join(qaHome, 'files', ...relativePath.split('/')))).toBe(false);
    } finally {
    if (previousRenderServiceId === undefined) delete process.env.RENDER_SERVICE_ID;
    else process.env.RENDER_SERVICE_ID = previousRenderServiceId;
    }
  });
});
