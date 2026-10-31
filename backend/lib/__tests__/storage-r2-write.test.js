const storage = require('../supabaseClient');

describe('Cloudflare R2 write behavior', () => {
  const keys = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_ENDPOINT',
    'CLOUDFLARE_R2_BUCKET',
  ];
  let original;

  beforeEach(() => {
    original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-test';
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-test';
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-test';
    process.env.CLOUDFLARE_R2_ENDPOINT = 'https://account-test.r2.cloudflarestorage.com';
    process.env.CLOUDFLARE_R2_BUCKET = 'school-files';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    keys.forEach((key) => {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    });
  });

  it('uses conditional create for non-upsert writes and allows explicit upserts', async () => {
    const client = storage.getR2Client();
    const send = jest.spyOn(client, 'send').mockResolvedValue({});

    await storage.uploadSchoolFile('school-a/student-profile/photo.png', Buffer.from('image'), { upsert: false });
    await storage.uploadSchoolFile('school-a/school-assets/logo.png', Buffer.from('image'), { upsert: true });

    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'school-files',
      Key: 'school-a/student-profile/photo.png',
      IfNoneMatch: '*',
    });
    expect(send.mock.calls[1][0].input).toMatchObject({
      Bucket: 'school-files',
      Key: 'school-a/school-assets/logo.png',
    });
    expect(send.mock.calls[1][0].input.IfNoneMatch).toBeUndefined();
  });
});
