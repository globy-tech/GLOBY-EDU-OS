jest.mock('../school.service', () => ({}));
jest.mock('../admissions.service', () => ({
  createAdmission: jest.fn(),
  getAdmissions: jest.fn(),
  updateAdmission: jest.fn(),
  decideAdmission: jest.fn(),
}));
jest.mock('../../audit/audit.service', () => ({
  listAuditEvents: jest.fn(),
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));

const admissionsService = require('../admissions.service');
const schoolRouter = require('../school.controller');
const { recordAuditEvent } = require('../../audit/audit.service');

const SCHOOL_ID = 'admissions-route-school';
const authority = {
  userId: 'authority-1',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
};

function routeHandler(method, path) {
  const layer = schoolRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error(`Admissions route not registered: ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('admission creation records an audit event after successful persistence', async () => {
  const admission = { applicationId: 'app-1', applicationNumber: 'ADM-2026-ABC123', status: 'pending' };
  admissionsService.createAdmission.mockResolvedValue(admission);
  const req = { params: { schoolId: SCHOOL_ID }, body: { fullName: 'Applicant' }, user: authority };
  const res = createResponse();

  await routeHandler('post', '/:schoolId/admissions')(req, res);

  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
    tenantId: SCHOOL_ID,
    actorId: authority.userId,
    action: 'admission.created',
    resourceType: 'admission',
    resourceId: 'app-1',
  }));
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({ status: 'ok', admission });
});

test('approval audit records the student and class enrollment only after the decision succeeds', async () => {
  const result = {
    admission: {
      applicationId: 'app-2',
      applicationNumber: 'ADM-2026-XYZ789',
      status: 'approved',
      classId: 'class-a',
      academicYearId: 'year-a',
    },
    student: { studentId: 'STD-001-AMA' },
    idempotent: false,
  };
  admissionsService.decideAdmission.mockResolvedValue(result);
  const req = {
    params: { schoolId: SCHOOL_ID, admissionId: 'app-2' },
    body: { decision: 'approved', classId: 'class-a', academicYearId: 'year-a' },
    user: authority,
  };
  const res = createResponse();

  await routeHandler('put', '/:schoolId/admissions/:admissionId/decision')(req, res);

  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
    action: 'admission.approved_and_enrolled',
    resourceId: 'app-2',
    metadata: expect.objectContaining({ studentId: 'STD-001-AMA', classId: 'class-a', academicYearId: 'year-a' }),
  }));
  expect(res.json).toHaveBeenCalledWith({ status: 'ok', ...result });
});

test('does not record a successful decision audit when enrollment fails', async () => {
  admissionsService.decideAdmission.mockRejectedValue(new Error('Enrollment persistence failed.'));
  const req = {
    params: { schoolId: SCHOOL_ID, admissionId: 'app-3' },
    body: { decision: 'approved' },
    user: authority,
  };
  const res = createResponse();

  await routeHandler('put', '/:schoolId/admissions/:admissionId/decision')(req, res);

  expect(recordAuditEvent).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'Enrollment persistence failed.' });
});

test('admission management routes are restricted to School Authority roles', () => {
  for (const [method, path] of [
    ['get', '/:schoolId/admissions'],
    ['post', '/:schoolId/admissions'],
    ['put', '/:schoolId/admissions/:admissionId'],
    ['put', '/:schoolId/admissions/:admissionId/decision'],
  ]) {
    const layer = schoolRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
    expect(layer.route.stack[0].name).toBe('authMiddleware');
    expect(layer.route.stack).toHaveLength(4);
  }
});
