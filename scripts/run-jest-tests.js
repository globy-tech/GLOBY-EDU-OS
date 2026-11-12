const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'globyedu-test-'));
const testDataFiles = {
  GLOBY_SCHOOLS_FILE: path.join(testDataDir, 'schools.json'),
  GLOBY_AUDIT_FILE: path.join(testDataDir, 'audit-logs.json'),
  GLOBY_PASSWORD_RESET_TOKENS_FILE: path.join(testDataDir, 'password-reset-tokens.json'),
};

for (const [key, value] of Object.entries(testDataFiles)) {
  process.env[key] = value;
}

function cleanupTestData() {
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

process.on('exit', cleanupTestData);
process.on('SIGINT', () => cleanupTestData());
process.on('SIGTERM', () => cleanupTestData());

const args = ['--passWithNoTests', '--runInBand', ...process.argv.slice(2)];
const child = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), ...args], {
  stdio: 'inherit',
  env: process.env,
});

cleanupTestData();
process.exit(child.status ?? 1);
