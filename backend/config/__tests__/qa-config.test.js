const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertIsolatedQaConfiguration, assertTestDataFilePath } = require('../qa-config');

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `globy-qa-config-${process.pid}-`));
}

function createQaEnv(qaHome) {
  return {
    GLOBY_QA_MODE: 'true',
    NODE_ENV: 'development',
    DATA_STORE_MODE: 'json',
    GLOBY_QA_HOME: qaHome,
    GLOBY_SCHOOLS_FILE: path.join(qaHome, 'schools.json'),
    GLOBY_AUDIT_FILE: path.join(qaHome, 'audit-logs.json'),
    GLOBY_PASSWORD_RESET_TOKENS_FILE: path.join(qaHome, 'password-reset-tokens.json'),
  };
}

describe('isolated QA configuration', () => {
  const qaHome = path.join(os.tmpdir(), `globy-qa-config-${process.pid}`);

  test.each(['GLOBY_SCHOOLS_FILE', 'GLOBY_AUDIT_FILE'])(
    'requires %s to be explicitly configured outside the repository in test mode',
    (variable) => {
      const repositoryFile = path.resolve(__dirname, '..', '..', 'data', 'synthetic-test-store.json');
      const externalFile = path.join(os.tmpdir(), `globy-test-store-${variable}-${process.pid}.json`);
      expect(() => assertTestDataFilePath({ NODE_ENV: 'test' }, variable)).toThrow(/required in test mode/);
      expect(() => assertTestDataFilePath({
        NODE_ENV: 'test',
        [variable]: repositoryFile,
      }, variable)).toThrow(/outside the repository in test mode/);
      expect(() => assertTestDataFilePath({
        NODE_ENV: 'test',
        [variable]: externalFile,
      }, variable)).not.toThrow();
    },
  );

  test('accepts explicit JSON stores outside the repository', () => {
    expect(() => assertIsolatedQaConfiguration(createQaEnv(qaHome))).not.toThrow();
  });

  test.each([
    ['production runtime', (env) => { env.NODE_ENV = 'production'; }],
    ['database connection', (env) => { env.DATABASE_URL = 'postgresql://not-used'; }],
    ['Firebase credentials', (env) => { env.FIREBASE_PRIVATE_KEY = 'not-a-real-key'; }],
    ['external payment provider', (env) => { env.PAYSTACK_SECRET_KEY = 'not-a-real-key'; }],
    ['non-JSON mode', (env) => { env.DATA_STORE_MODE = 'firebase'; }],
    ['missing school store', (env) => { delete env.GLOBY_SCHOOLS_FILE; }],
    ['missing audit store', (env) => { delete env.GLOBY_AUDIT_FILE; }],
    ['audit store outside QA home', (env) => { env.GLOBY_AUDIT_FILE = path.join(os.tmpdir(), 'outside-audit-logs.json'); }],
    ['repository data directory', (env) => { env.GLOBY_QA_HOME = path.resolve(__dirname, '..', '..', '..'); }],
    ['protected school store', (env) => { env.GLOBY_SCHOOLS_FILE = path.resolve(__dirname, '..', '..', 'data', 'schools.json'); }],
  ])('rejects unsafe %s configuration', (label, updateEnv) => {
    const env = createQaEnv(qaHome);
    updateEnv(env);
    expect(() => assertIsolatedQaConfiguration(env)).toThrow();
  });

  test('rejects a QA home symlinked into the repository', () => {
    const tempDirectory = createTempDirectory();
    try {
      const linkedHome = path.join(tempDirectory, 'repository');
      const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
      fs.symlinkSync(repositoryRoot, linkedHome, 'junction');
      expect(() => assertIsolatedQaConfiguration(createQaEnv(linkedHome))).toThrow(/outside the repository/);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  test('rejects a configured store reached through a symlink into the repository', () => {
    const tempDirectory = createTempDirectory();
    try {
      const env = createQaEnv(tempDirectory);
      const linkedDirectory = path.join(tempDirectory, 'repository');
      const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
      fs.symlinkSync(repositoryRoot, linkedDirectory, 'junction');
      env.GLOBY_SCHOOLS_FILE = path.join(linkedDirectory, 'package.json');
      expect(() => assertIsolatedQaConfiguration(env)).toThrow(/inside GLOBY_QA_HOME/);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
