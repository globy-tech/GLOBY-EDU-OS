jest.mock('../../audit/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));

const authMiddleware = require('../../auth/middleware/auth.middleware');
const schoolService = require('../school.service');
const schoolRouter = require('../school.controller');
const { recordAuditEvent } = require('../../audit/audit.service');

const PLATFORM_ADMIN = {
  userId: 'platform-admin-test',
  roles: ['super_admin'],
  platformAdmin: true,
  tenantId: null,
  schoolId: null,
};
const SCHOOL_ID = 'archive-route-test-001';
const SCHOOL = {
  schoolId: SCHOOL_ID,
  name: 'Archive Route Test School',
  archivedAt: '2026-10-02T00:00:00.000Z',
  schoolStatus: 'active',
  subscriptionStatus: 'trial',
};

const protectedRoutes = [
  ['delete', '/:schoolId'],
  ['get', '/archived'],
  ['post', '/:schoolId/archive'],
  ['post', '/:schoolId/restore'],
  ['delete', '/:schoolId/permanent'],
];

function routeHandlers(method, routePath) {
  const layer = schoolRouter.stack.find((entry) => entry.route?.path === routePath && entry.route.methods[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack;
}

function createResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest() {
  return {
    params: { schoolId: SCHOOL_ID },
    query: { search: 'Archive Route', status: 'trial' },
    body: {},
    user: PLATFORM_ADMIN,
    ip: '127.0.0.1',
    get: () => 'archive-test-agent',
  };
}

describe('Super Admin school archive routes', () => {
  beforeEach(() => recordAuditEvent.mockClear());
  afterEach(() => jest.restoreAllMocks());

  it.each(protectedRoutes)('%s %s runs authentication and rejects non-Super-Admin roles', (method, routePath) => {
    const handlers = routeHandlers(method, routePath);
    expect(handlers[0].handle).toBe(authMiddleware);

    const req = { user: { roles: ['school_authority'], platformAdmin: false, tenantId: SCHOOL_ID } };
    const res = createResponse();
    const next = jest.fn();
    handlers[1].handle(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(protectedRoutes)('%s %s accepts a tenantless platform administrator', (method, routePath) => {
    const handlers = routeHandlers(method, routePath);
    const req = { user: PLATFORM_ADMIN };
    const res = createResponse();
    const next = jest.fn();
    handlers[1].handle(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('routes active-school DELETE through the protected soft-suspend service and records an audit event', async () => {
    const school = { ...SCHOOL, id: 'firebase-tenant-id' };
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(school);
    const suspend = jest.spyOn(schoolService, 'deleteSchool').mockResolvedValue({ ...school, schoolStatus: 'suspended' });
    const handlers = routeHandlers('delete', '/:schoolId');
    const req = createRequest();
    const res = createResponse();

    await handlers[2].handle(req, res);

    expect(suspend).toHaveBeenCalledWith('firebase-tenant-id');
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: SCHOOL_ID,
      action: 'school.suspended',
      resourceId: SCHOOL_ID,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });

  it('rejects tenant edits to subscription lifecycle fields before persistence', async () => {
    const updateSchool = jest.spyOn(schoolService, 'updateSchool');
    const handlers = routeHandlers('put', '/:schoolId');
    const req = {
      ...createRequest(),
      user: { userId: 'school-authority-1', roles: ['school_authority'], tenantId: SCHOOL_ID, platformAdmin: false },
      body: { subscriptionStatus: 'active', expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() },
    };
    const res = createResponse();

    await handlers[3].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(updateSchool).not.toHaveBeenCalled();
  });

  it.each(['payments', 'receipts'])('rejects generic school updates containing %s', async (field) => {
    const updateSchool = jest.spyOn(schoolService, 'updateSchool');
    const handlers = routeHandlers('put', '/:schoolId');
    const req = {
      ...createRequest(),
      user: { userId: 'school-authority-1', roles: ['school_authority'], tenantId: SCHOOL_ID, platformAdmin: false },
      body: { [field]: [{ id: 'synthetic-payment', amount: 25 }] },
    };
    const res = createResponse();

    await handlers[handlers.length - 1].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Payments and receipts must be recorded through the fee-payment endpoint.',
    }));
    expect(updateSchool).not.toHaveBeenCalled();
  });

  it('continues to allow unrelated generic school updates', async () => {
    const school = { ...SCHOOL, id: 'generic-update-tenant-id', archivedAt: null };
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(school);
    const updateSchool = jest.spyOn(schoolService, 'updateSchool').mockResolvedValue({ ...school, name: 'Updated Synthetic School' });
    const handlers = routeHandlers('put', '/:schoolId');
    const req = {
      ...createRequest(),
      user: { userId: 'school-authority-1', roles: ['school_authority'], tenantId: SCHOOL_ID, platformAdmin: false },
      body: { name: 'Updated Synthetic School' },
    };
    const res = createResponse();

    await handlers[handlers.length - 1].handle(req, res);

    expect(updateSchool).toHaveBeenCalledWith(school.id, req.body);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      school: expect.objectContaining({ name: 'Updated Synthetic School' }),
    }));
  });

  it('records valid payments through the dedicated fee-payment route', async () => {
    const payment = { id: 'PMT-2026-000001', schoolId: SCHOOL_ID, studentId: 'STU-SYNTHETIC', reference: 'SYNTHETIC-REF' };
    const receipt = { receiptNumber: 'RCPT-2026-000001', paymentId: payment.id, schoolId: SCHOOL_ID };
    const createFeePayment = jest.spyOn(schoolService, 'createFeePayment').mockResolvedValue({ payment, receipt });
    const handlers = routeHandlers('post', '/:schoolId/payments');
    const req = {
      ...createRequest(),
      user: { userId: 'school-authority-1', roles: ['school_authority'], tenantId: SCHOOL_ID, platformAdmin: false },
      body: { studentId: 'STU-SYNTHETIC', amount: 25, reference: 'SYNTHETIC-REF' },
    };
    const res = createResponse();

    await handlers[handlers.length - 1].handle(req, res);

    expect(createFeePayment).toHaveBeenCalledWith(SCHOOL_ID, req.body, req.user);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', payment, receipt });
  });

  it('returns duplicate-reference errors from the dedicated fee-payment route', async () => {
    const createFeePayment = jest.spyOn(schoolService, 'createFeePayment')
      .mockRejectedValue(new Error('Payment reference has already been recorded.'));
    const handlers = routeHandlers('post', '/:schoolId/payments');
    const req = {
      ...createRequest(),
      user: { userId: 'school-authority-1', roles: ['school_authority'], tenantId: SCHOOL_ID, platformAdmin: false },
      body: { studentId: 'STU-SYNTHETIC', amount: 25, reference: 'SYNTHETIC-REF' },
    };
    const res = createResponse();

    await handlers[handlers.length - 1].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'Payment reference has already been recorded.' });
  });

  it.each([
    ['STU-A', 'student', 'report-a'],
    ['STU-B', 'student', 'report-b'],
    ['T-A', 'teacher', 'report-a'],
  ])('GET school details scopes report cards for %s (%s)', async (userId, role, expectedReportId) => {
    const school = {
      ...SCHOOL,
      id: 'report-card-tenant-id',
      archivedAt: null,
      students: [
        { studentId: 'STU-A', fullName: 'Student Alpha', classId: 'class-a', className: 'Class A' },
        { studentId: 'STU-B', fullName: 'Student Beta', classId: 'class-b', className: 'Class B' },
      ],
      teachers: [{ teacherId: 'T-A', username: 'T-A', assignedSubjects: ['Math'] }],
      classes: [
        { classId: 'class-a', name: 'Class A', teacherId: 'T-A' },
        { classId: 'class-b', name: 'Class B', teacherId: 'T-B' },
      ],
      reportCards: [
        { id: 'report-a', student: 'Student Alpha', term: 'Term 1', academicYear: '2026/2027', grade: 'A' },
        { id: 'report-b', student: 'Student Beta', term: 'Term 1', academicYear: '2026/2027', grade: 'C' },
      ],
      attendanceRecords: [
        { studentId: 'STU-A', className: 'Class A', status: 'present' },
        { studentId: 'STU-B', className: 'Class B', status: 'absent' },
      ],
      examResults: [
        { studentId: 'STU-A', subject: 'Math', mark: 95 },
        { studentId: 'STU-B', subject: 'Math', mark: 60 },
      ],
    };
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue(school);
    const handlers = routeHandlers('get', '/:schoolId');
    const req = {
      ...createRequest(),
      user: { userId: `${SCHOOL_ID}:${userId}`, roles: [role], tenantId: SCHOOL_ID, platformAdmin: false },
    };
    const res = createResponse();

    expect(handlers[0].handle).toBe(authMiddleware);
    await handlers[handlers.length - 1].handle(req, res);

    const responseSchool = res.json.mock.calls[0][0].school;
    expect(responseSchool.reportCards).toEqual([school.reportCards.find((card) => card.id === expectedReportId)]);
    expect(responseSchool.schoolId).toBe(SCHOOL_ID);
    expect(responseSchool.attendanceRecords).toHaveLength(role === 'teacher' ? 1 : 1);
    expect(responseSchool.examResults).toHaveLength(1);
    if (role === 'student') expect(responseSchool.student.studentId).toBe(userId);
    else expect(responseSchool.students.map((student) => student.studentId)).toEqual(['STU-A']);
  });

  it.each([
    ['post', '/:schoolId/archive', 'archiveSchool', { ...SCHOOL }, 'school.archived'],
    ['post', '/:schoolId/restore', 'restoreSchool', { ...SCHOOL, archivedAt: null }, 'school.restored'],
    ['delete', '/:schoolId/permanent', 'permanentlyDeleteArchivedSchool', { schoolId: SCHOOL_ID, name: SCHOOL.name }, 'school.permanently_deleted'],
  ])('%s %s records the lifecycle audit event after the service succeeds', async (method, routePath, serviceMethod, serviceResult, action) => {
    jest.spyOn(schoolService, serviceMethod).mockResolvedValue(serviceResult);
    const handlers = routeHandlers(method, routePath);
    const req = createRequest();
    const res = createResponse();

    await handlers[2].handle(req, res);

    expect(schoolService[serviceMethod]).toHaveBeenCalledWith(SCHOOL_ID);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorId: PLATFORM_ADMIN.userId,
      actorRole: 'super_admin',
      tenantId: SCHOOL_ID,
      action,
      resourceType: 'school',
      resourceId: SCHOOL_ID,
    }));
  });

  it.each([
    [{ code: 'SCHOOL_NOT_FOUND', message: 'School not found' }, 404],
    [new Error('Firestore unavailable'), 500],
  ])('returns a controlled error and does not audit a failed permanent deletion', async (failure, expectedStatus) => {
    jest.spyOn(schoolService, 'permanentlyDeleteArchivedSchool').mockRejectedValue(failure);
    const handlers = routeHandlers('delete', '/:schoolId/permanent');
    const req = createRequest();
    const res = createResponse();

    await handlers[2].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
