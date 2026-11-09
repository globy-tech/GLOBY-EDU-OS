const fs = require('fs');
const os = require('os');
const path = require('path');
const { EXTERNAL_SERVICE_VARIABLES } = require('../../../config/qa-config');

function useIsolatedSchoolStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globyedu-school-test-'));
  const paths = {
    GLOBY_QA_HOME: directory,
    GLOBY_SCHOOLS_FILE: path.join(directory, 'schools.json'),
    GLOBY_AUDIT_FILE: path.join(directory, 'audit-logs.json'),
    GLOBY_PASSWORD_RESET_TOKENS_FILE: path.join(directory, 'password-reset-tokens.json'),
  };
  const environmentKeys = [
    ...EXTERNAL_SERVICE_VARIABLES,
    'DATABASE_URL',
    'USE_REAL_DATABASE',
    'RENDER_SERVICE_ID',
    'NODE_ENV',
    'DATA_STORE_MODE',
    'GLOBY_QA_MODE',
    ...Object.keys(paths),
  ];
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  EXTERNAL_SERVICE_VARIABLES.forEach((key) => { delete process.env[key]; });
  delete process.env.DATABASE_URL;
  delete process.env.USE_REAL_DATABASE;
  delete process.env.RENDER_SERVICE_ID;
  process.env.NODE_ENV = 'test';
  process.env.DATA_STORE_MODE = 'json';
  process.env.GLOBY_QA_MODE = 'true';
  Object.assign(process.env, paths);
  fs.writeFileSync(paths.GLOBY_SCHOOLS_FILE, JSON.stringify({ schools: [] }), 'utf8');

  return () => {
    try {
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

describe('isolated school store helper', () => {
  it('configures isolated QA storage and restores the prior environment on cleanup', () => {
    const previousEnvironment = new Map([
      'GLOBY_QA_HOME',
      'GLOBY_SCHOOLS_FILE',
      'GLOBY_AUDIT_FILE',
      'GLOBY_PASSWORD_RESET_TOKENS_FILE',
      'GLOBY_QA_MODE',
      'DATA_STORE_MODE',
    ].map((key) => [key, process.env[key]]));
    const cleanup = useIsolatedSchoolStore();

    expect(process.env.GLOBY_QA_MODE).toBe('true');
    expect(process.env.GLOBY_QA_HOME).toBeDefined();
    const schoolFile = process.env.GLOBY_SCHOOLS_FILE;
    expect(fs.existsSync(schoolFile)).toBe(true);
    expect(path.dirname(schoolFile)).toBe(process.env.GLOBY_QA_HOME);
    expect(path.dirname(process.env.GLOBY_AUDIT_FILE)).toBe(process.env.GLOBY_QA_HOME);
    expect(path.dirname(process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE)).toBe(process.env.GLOBY_QA_HOME);

    cleanup();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) expect(process.env[key]).toBeUndefined();
      else expect(process.env[key]).toBe(value);
    }
    expect(fs.existsSync(schoolFile)).toBe(false);
  });
});

module.exports = useIsolatedSchoolStore;
