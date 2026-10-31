const fs = require('fs');
const os = require('os');
const path = require('path');

describe('isolated audit storage path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globy-audit-path-'));
  const auditFile = path.join(directory, 'audit-logs.json');
  const originalEnvironment = {
    GLOBY_AUDIT_FILE: process.env.GLOBY_AUDIT_FILE,
    DATA_STORE_MODE: process.env.DATA_STORE_MODE,
  };
  let auditService;

  beforeAll(() => {
    process.env.GLOBY_AUDIT_FILE = auditFile;
    process.env.DATA_STORE_MODE = 'json';
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
});
