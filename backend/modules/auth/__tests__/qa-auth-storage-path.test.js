const fs = require('fs');
const os = require('os');
const path = require('path');

describe('isolated QA authentication storage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-qa-auth-'));
  const schoolsFile = path.join(directory, 'schools.json');
  const environmentKeys = ['DATA_STORE_MODE', 'GLOBY_SCHOOLS_FILE'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  let findFallbackUser;

  beforeAll(() => {
    fs.writeFileSync(schoolsFile, JSON.stringify({
      schools: [{
        schoolId: 'QA-ISOLATION-TEST',
        users: [{
          username: 'qa-teacher',
          role: 'teacher',
          status: 'active',
          emailVerified: true,
        }],
      }],
    }));
    process.env.DATA_STORE_MODE = 'json';
    process.env.GLOBY_SCHOOLS_FILE = schoolsFile;
    jest.resetModules();
    ({ findFallbackUser } = require('../middleware/fallback-user'));
  });

  afterAll(() => {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('resolves account status from the explicitly configured QA schools file', () => {
    expect(findFallbackUser('QA-ISOLATION-TEST', 'qa-teacher')).toMatchObject({
      userId: 'QA-ISOLATION-TEST:qa-teacher',
      tenantId: 'QA-ISOLATION-TEST',
      roles: ['teacher'],
      status: 'active',
    });
  });
});
