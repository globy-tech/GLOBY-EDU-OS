jest.mock('../school.service', () => ({}));
jest.mock('../admissions.service', () => ({}));
jest.mock('../academic-progression.service', () => ({
  previewProgression: jest.fn(),
  confirmProgression: jest.fn(),
}));
jest.mock('../../audit/audit.service', () => ({
  listAuditEvents: jest.fn(),
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));

const progressionService = require('../academic-progression.service');
const schoolRouter = require('../school.controller');
const { recordAuditEvent } = require('../../audit/audit.service');

const SCHOOL_ID = 'progression-route-school';
const authority = { userId: 'authority-1', roles: ['school_authority'], tenantId: SCHOOL_ID };

function routeHandler(method, path) {
  const layer = schoolRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error(`Progression route not registered: ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

beforeEach(() => jest.clearAllMocks());

test('progression preview returns the school-scoped preview', async () => {
  const preview = { students: [{ studentId: 'STD-1', action: 'promote' }] };
  progressionService.previewProgression.mockResolvedValue(preview);
  const req = {
    params: { schoolId: SCHOOL_ID },
    query: { fromAcademicYearId: 'year-1', targetAcademicYearId: 'year-2' },
    user: authority,
  };
  const res = createResponse();

  await routeHandler('get', '/:schoolId/progression/preview')(req, res);

  expect(progressionService.previewProgression).toHaveBeenCalledWith(SCHOOL_ID, req.query, authority);
  expect(res.json).toHaveBeenCalledWith({ status: 'ok', preview });
});

test('confirmation audits completed decisions after persistence succeeds', async () => {
  const result = {
    operationId: 'progression-operation-1',
    fromAcademicYearId: 'year-1',
    targetAcademicYearId: 'year-2',
    results: [{ studentId: 'STD-1', action: 'promote', idempotent: false }],
  };
  progressionService.confirmProgression.mockResolvedValue(result);
  const req = { params: { schoolId: SCHOOL_ID }, body: { confirmed: true }, user: authority };
  const res = createResponse();

  await routeHandler('post', '/:schoolId/progression/confirm')(req, res);

  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
    tenantId: SCHOOL_ID,
    action: 'student.progression_completed',
    resourceType: 'academic_progression',
    resourceId: result.operationId,
    metadata: expect.objectContaining({ decisions: { promote: 1 }, idempotentRetry: false }),
  }));
  expect(res.json).toHaveBeenCalledWith({ status: 'ok', ...result });
});

test('does not audit a successful progression when persistence fails', async () => {
  progressionService.confirmProgression.mockRejectedValue(new Error('Enrollment conflict.'));
  const req = { params: { schoolId: SCHOOL_ID }, body: { confirmed: true }, user: authority };
  const res = createResponse();

  await routeHandler('post', '/:schoolId/progression/confirm')(req, res);

  expect(recordAuditEvent).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'Enrollment conflict.' });
});

test('progression routes require authentication, tenant matching, and authority roles', () => {
  for (const [method, path] of [
    ['get', '/:schoolId/progression/preview'],
    ['post', '/:schoolId/progression/confirm'],
  ]) {
    const layer = schoolRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
    expect(layer.route.stack[0].name).toBe('authMiddleware');
    expect(layer.route.stack).toHaveLength(4);
  }
});
