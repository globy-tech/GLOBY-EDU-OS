const fs = require('fs');
const path = require('path');
const useIsolatedSchoolStore = require('../../school/__tests__/isolated-school-store');

describe('isolated QA authentication storage', () => {
  const cleanupIsolatedSchoolStore = useIsolatedSchoolStore();
  const schoolsFile = process.env.GLOBY_SCHOOLS_FILE;
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
    cleanupIsolatedSchoolStore();
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
