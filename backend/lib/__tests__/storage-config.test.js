const storage = require('../supabaseClient');

describe('Cloudflare R2 configuration', () => {
  const keys = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_ENDPOINT',
    'CLOUDFLARE_R2_BUCKET',
    'CLOUDFLARE_R2_PUBLIC_URL',
  ];
  let original;

  beforeEach(() => {
    original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    keys.forEach((key) => {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    });
  });

  it('requires account, endpoint, access credentials, and an explicit bucket', () => {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-test';
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-test';
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-test';
    process.env.CLOUDFLARE_R2_ENDPOINT = 'https://account-test.r2.cloudflarestorage.com';

    expect(storage.isR2Configured()).toBe(false);

    process.env.CLOUDFLARE_R2_BUCKET = 'school-files';
    expect(storage.isR2Configured()).toBe(true);
    expect(storage.getR2ConfigurationStatus()).toEqual({
      configured: true,
      missingVariables: [],
      invalidVariables: [],
    });
  });

  it('reports incomplete configuration by variable name without exposing values', () => {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-test';
    process.env.CLOUDFLARE_R2_ENDPOINT = 'https://wrong-account.r2.cloudflarestorage.com';

    expect(storage.getR2ConfigurationStatus()).toEqual({
      configured: false,
      missingVariables: [
        'CLOUDFLARE_R2_ACCESS_KEY_ID',
        'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
        'CLOUDFLARE_R2_BUCKET',
      ],
      invalidVariables: ['CLOUDFLARE_R2_ENDPOINT'],
    });
  });

  it('identifies all missing credentials, including the account ID, when creating the client', () => {
    expect(() => storage.getR2Client()).toThrow(
      'Cloudflare R2 configuration is unavailable: missing CLOUDFLARE_R2_ACCOUNT_ID, missing CLOUDFLARE_R2_ENDPOINT, missing CLOUDFLARE_R2_ACCESS_KEY_ID, missing CLOUDFLARE_R2_SECRET_ACCESS_KEY, missing CLOUDFLARE_R2_BUCKET.',
    );
  });

  it('rejects placeholder public URLs and builds tenant-path URLs only from a configured base', () => {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-test';
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-test';
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-test';
    process.env.CLOUDFLARE_R2_ENDPOINT = 'https://account-test.r2.cloudflarestorage.com';
    process.env.CLOUDFLARE_R2_BUCKET = 'school-files';
    process.env.CLOUDFLARE_R2_PUBLIC_URL = 'https://pub-<hash>.r2.dev';
    expect(storage.isR2PublicUrlConfigured()).toBe(false);
    expect(storage.getSchoolFilePublicUrl('school-a/students/photo.png')).toBeNull();

    process.env.CLOUDFLARE_R2_PUBLIC_URL = 'https://files.example.test';
    expect(storage.isR2PublicUrlConfigured()).toBe(true);
    expect(storage.getSchoolFilePublicUrl('school-a/students/photo.png')).toBe('https://files.example.test/school-a/students/photo.png');
    expect(storage.getSchoolFilePublicUrl('school-a/student photos/profile image.png')).toBe('https://files.example.test/school-a/student%20photos/profile%20image.png');
  });

  it('rejects the private R2 S3 endpoint as a public object URL', () => {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-test';
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-test';
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-test';
    process.env.CLOUDFLARE_R2_ENDPOINT = 'https://account-test.r2.cloudflarestorage.com';
    process.env.CLOUDFLARE_R2_BUCKET = 'school-files';

    for (const privateUrl of [
      'https://account-test.r2.cloudflarestorage.com',
      'https://account-test.r2.cloudflarestorage.com/school-files',
    ]) {
      process.env.CLOUDFLARE_R2_PUBLIC_URL = privateUrl;
      expect(storage.isR2PublicUrlConfigured()).toBe(false);
      expect(storage.getSchoolFilePublicUrl('school-a/students/photo.png')).toBeNull();
    }
  });
});