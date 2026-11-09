const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../firebase.data', () => ({ isFirebaseDataConfigured: () => false }));
jest.mock('../../../config/prisma.client', () => ({ __stub: true }));

describe('isolated audit storage path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-audit-path-'));
  const auditFile = path.join(directory, 'audit-logs.json');
  const schoolFile = path.join(directory, 'schools.json');
  const passwordResetTokensFile = path.join(directory, 'password-reset-tokens.json');
  const originalEnvironment = {
    GLOBY_AUDIT_FILE: process.env.GLOBY_AUDIT_FILE,
    DATA_STORE_MODE: process.env.DATA_STORE_MODE,
    GLOBY_QA_MODE: process.env.GLOBY_QA_MODE,
    GLOBY_QA_HOME: process.env.GLOBY_QA_HOME,
    GLOBY_SCHOOLS_FILE: process.env.GLOBY_SCHOOLS_FILE,
    GLOBY_PASSWORD_RESET_TOKENS_FILE: process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE,
  };
  let auditService;

  beforeAll(() => {
    process.env.GLOBY_AUDIT_FILE = auditFile;
    process.env.DATA_STORE_MODE = 'json';
    process.env.GLOBY_QA_MODE = 'false';
    jest.resetModules();
    auditService = require('../audit.service');
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('writes fallback audit events only to the configured QA file', async () => {
    await auditService.recordAuditEvent({
      tenantId: 'qa-school',
      actorRole: 'teacher',
      action: 'qa.test_event',
    });

    const stored = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
    expect(stored.logs).toHaveLength(1);
    expect(stored.logs[0]).toMatchObject({ tenantId: 'qa-school', action: 'qa.test_event' });
  });

  test('fails closed when isolated QA audit storage is missing', async () => {
    const externalServiceVariables = require('../../../config/qa-config').EXTERNAL_SERVICE_VARIABLES;
    const previousExternalValues = new Map(externalServiceVariables.map((key) => [key, process.env[key]]));
    externalServiceVariables.forEach((key) => { delete process.env[key]; });
    process.env.GLOBY_QA_MODE = 'true';
    process.env.GLOBY_QA_HOME = directory;
    process.env.GLOBY_SCHOOLS_FILE = schoolFile;
    process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE = passwordResetTokensFile;
    delete process.env.GLOBY_AUDIT_FILE;

    try {
      await expect(auditService.listAuditEvents({ tenantId: 'qa-school' }))
        .rejects.toThrow('GLOBY_AUDIT_FILE is required in isolated QA mode.');
    } finally {
      for (const [key, value] of previousExternalValues) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
