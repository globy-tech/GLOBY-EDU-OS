const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const authRouter = require('../../../routes/auth');
const apiRouter = require('../../../routes/api');
const { signAccessToken } = require('../../auth/utils/token');
const { recordAuditEvent, listAuditEvents } = require('../audit.service');
const { ensureDemoSchool } = require('../../school/fallback.school');

const schoolsFile = path.join(__dirname, '../../../data/schools.json');
const auditFile = path.join(__dirname, '../../../data/audit-logs.json');
const originalSchools = fs.readFileSync(schoolsFile, 'utf8');

function createServer(router, mount = '/api/v1') {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app.listen(0);
}

function token({ userId, tenantId, roles, platformAdmin = false }) {
  return signAccessToken({ userId, tenantId, roles, platformAdmin, passwordNeedsReset: false });
}

describe('backend audit logging', () => {
  let authServer;
  let apiServer;

  beforeAll(() => {
    fs.writeFileSync(auditFile, JSON.stringify({ logs: [] }, null, 2), 'utf8');
    ensureDemoSchool();
    authServer = createServer(authRouter, '/api/v1/auth');
    apiServer = createServer(apiRouter);
  });

  afterAll(async () => {
    fs.writeFileSync(schoolsFile, originalSchools, 'utf8');
    if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
    await Promise.all([
      new Promise((resolve) => authServer.close(resolve)),
      new Promise((resolve) => apiServer.close(resolve)),
    ]);
  });

  test('successful and failed fallback logins create tenant-aware audit events', async () => {
    const port = authServer.address().port;
    const valid = await fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'globy-school', username: 'T001', password: 'GlobyTeacher@123', loginType: 'teacher' }),
    });
    expect(valid.status).toBe(200);

    const failed = await fetch(`http://127.0.0.1:${port}/api/v1/auth/school-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'globy-school', username: 'T001', password: 'WrongPassword!1', loginType: 'teacher' }),
    });
    expect(failed.status).toBe(401);

    const logs = await listAuditEvents({ tenantId: 'globy-school' });
    expect(logs.some((entry) => entry.action === 'auth.login_succeeded' && entry.tenantId === 'globy-school')).toBe(true);
    expect(logs.some((entry) => entry.action === 'auth.login_failed' && entry.success === false)).toBe(true);
  }, 20000);

  test('school lifecycle and teacher/student management actions are audited', async () => {
    const port = apiServer.address().port;
    const runId = crypto.randomUUID();
    const adminToken = token({ userId: 'ataetabenjamin@gmail.com', tenantId: null, roles: ['super_admin'], platformAdmin: true });
    const authorityToken = token({ userId: 'globy-school:authority@globyedu.test', tenantId: 'globy-school', roles: ['school_authority'] });

    const activate = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/activate`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(activate.status).toBe(200);

      const suspend = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(suspend.status).toBe(200);

      const reactivate = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/activate`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(reactivate.status).toBe(200);

    const teacher = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/entities/teachers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authorityToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Audited Teacher', email: `audited-teacher-${runId}@globy.test` }),
    });
    expect(teacher.status).toBe(201);

    const student = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/entities/students`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authorityToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Audited Student', email: `audited-student-${runId}@globy.test` }),
    });
    expect(student.status).toBe(201);

    const teacherBody = await teacher.json();
    const studentBody = await student.json();
    const teacherId = teacherBody.entity?.teacherId || teacherBody.entity?.email;
    const studentId = studentBody.entity?.studentId || studentBody.entity?.email;

    const teacherUpdate = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/entities/teachers/${encodeURIComponent(teacherId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authorityToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 'Senior Teacher' }),
    });
    expect(teacherUpdate.status).toBe(200);

    const studentUpdate = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/entities/students/${encodeURIComponent(studentId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authorityToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ className: 'JHS 3' }),
    });
    expect(studentUpdate.status).toBe(200);

    const teacherArchive = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/entities/teachers/${encodeURIComponent(teacherId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${authorityToken}` },
    });
    expect(teacherArchive.status).toBe(200);

    const studentArchive = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/entities/students/${encodeURIComponent(studentId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${authorityToken}` },
    });
    expect(studentArchive.status).toBe(200);

    const logs = await listAuditEvents({ tenantId: 'globy-school' });
    expect(logs.some((entry) => entry.action === 'school.activated' && entry.actorRole === 'super_admin')).toBe(true);
      expect(logs.some((entry) => entry.action === 'school.suspended' && entry.actorRole === 'super_admin')).toBe(true);
    expect(logs.some((entry) => entry.action === 'teacher.created' && entry.actorRole === 'school_authority')).toBe(true);
    expect(logs.some((entry) => entry.action === 'student.created' && entry.actorRole === 'school_authority')).toBe(true);
      expect(logs.some((entry) => entry.action === 'teacher.updated')).toBe(true);
      expect(logs.some((entry) => entry.action === 'student.updated')).toBe(true);
      expect(logs.some((entry) => entry.action === 'teacher.archived')).toBe(true);
      expect(logs.some((entry) => entry.action === 'student.archived')).toBe(true);
  }, 20000);

  test('school authority cannot submit teacher attendance records', async () => {
    const port = apiServer.address().port;
    const authorityToken = token({ userId: 'globy-school:authority@globyedu.test', tenantId: 'globy-school', roles: ['school_authority'] });
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authorityToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceRecords: [{ studentId: 'STU001', status: 'present' }] }),
    });

    expect(response.status).toBe(403);
  });

  test('school authority can read teacher activity without message contents or request metadata', async () => {
    const port = apiServer.address().port;
    const teacherToken = token({ userId: 'globy-school:T001', tenantId: 'globy-school', roles: ['teacher'] });
    const authorityToken = token({ userId: 'globy-school:authority@globyedu.test', tenantId: 'globy-school', roles: ['school_authority'] });
    const sent = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/messages`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', teacherToken].join(' '),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipientId: 'STU001', subject: 'Class notice', body: 'Private message content.' }),
    });
    expect(sent.status).toBe(201);

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/activity`, {
      headers: { Authorization: ['Bearer', authorityToken].join(' ') },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'teacher.message.sent', actorId: 'globy-school:T001' }),
    ]));
    expect(JSON.stringify(body)).not.toContain('Private message content.');
    expect(JSON.stringify(body)).not.toContain('userAgent');
    expect(JSON.stringify(body)).not.toContain('resourceId');

    const teacherResponse = await fetch(`http://127.0.0.1:${port}/api/v1/schools/globy-school/activity`, {
      headers: { Authorization: ['Bearer', teacherToken].join(' ') },
    });
    expect(teacherResponse.status).toBe(403);
  });

  test('only Super Admin can read audit logs and records never contain secrets', async () => {
    await recordAuditEvent({
      actorId: 'actor-1',
      actorRole: 'school_authority',
      tenantId: 'globy-school',
      action: 'security.test',
      metadata: {
        password: 'PlaintextPassword!1',
        passwordHash: '$2b$12$hash',
        accessToken: 'jwt-secret',
        safeContext: 'profile update',
      },
    });

    const port = apiServer.address().port;
    const teacherToken = token({ userId: 'globy-school:T001', tenantId: 'globy-school', roles: ['teacher'] });
    const denied = await fetch(`http://127.0.0.1:${port}/api/v1/audit-logs`, { headers: { Authorization: `Bearer ${teacherToken}` } });
    expect(denied.status).toBe(403);

      const authorityToken = token({ userId: 'globy-school:authority@globyedu.test', tenantId: 'globy-school', roles: ['school_authority'] });
      const authorityDenied = await fetch(`http://127.0.0.1:${port}/api/v1/audit-logs`, { headers: { Authorization: `Bearer ${authorityToken}` } });
      expect(authorityDenied.status).toBe(403);

    const adminToken = token({ userId: 'ataetabenjamin@gmail.com', tenantId: null, roles: ['super_admin'], platformAdmin: true });
    const allowed = await fetch(`http://127.0.0.1:${port}/api/v1/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = await allowed.json();
    expect(allowed.status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('PlaintextPassword!1');
    expect(serialized).not.toContain('$2b$12$hash');
    expect(serialized).not.toContain('jwt-secret');
      expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload.signature');
      expect(serialized).not.toContain('$2b$12$not-a-real-hash');
    expect(serialized).toContain('profile update');
  });
});
