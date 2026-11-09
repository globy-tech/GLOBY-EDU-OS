jest.mock('../../audit/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));

const schoolService = require('../school.service');
const schoolRouter = require('../school.controller');
const { recordAuditEvent } = require('../../audit/audit.service');

const SCHOOL_ID = 'account-deletion-route-test';
const AUTHORITY = {
  userId: 'authority-test',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
};

function deletionApprovalHandler() {
  const layer = schoolRouter.stack.find((entry) =>
    entry.route?.path === '/:schoolId/entities/students/:studentId/deletion-request' &&
    entry.route.methods.put
  );
  if (!layer) throw new Error('Student deletion approval route was not registered.');
  return layer.route.stack[layer.route.stack.length - 1].handle;
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

describe('School Authority student deletion approval audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records a successful audit event after approval cleanup completes', async () => {
    jest.spyOn(schoolService, 'resolveStudentDeletionRequest').mockResolvedValue({
      studentId: 'STU-100',
      status: 'approved',
      accountCleanup: { status: 'completed', completeErasure: false },
    });
    const req = {
      params: { schoolId: SCHOOL_ID, studentId: 'STU-100' },
      body: { decision: 'approved', confirmation: 'STU-100' },
      user: AUTHORITY,
    };
    const res = createResponse();

    await deletionApprovalHandler()(req, res);

    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: SCHOOL_ID,
      actorId: AUTHORITY.userId,
      action: 'student.deletion_approved',
      resourceType: 'student',
      resourceId: 'STU-100',
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'approved',
      accountCleanup: { status: 'completed', completeErasure: false },
    }));
  });

  it('does not record a successful audit event when cleanup fails', async () => {
    jest.spyOn(schoolService, 'resolveStudentDeletionRequest')
      .mockRejectedValue(new Error('Firebase Auth unavailable'));
    const req = {
      params: { schoolId: SCHOOL_ID, studentId: 'STU-100' },
      body: { decision: 'approved', confirmation: 'STU-100' },
      user: AUTHORITY,
    };
    const res = createResponse();

    await deletionApprovalHandler()(req, res);

    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Firebase Auth unavailable',
    });
  });
});
