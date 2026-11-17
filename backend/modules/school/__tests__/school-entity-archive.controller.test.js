jest.mock('../../audit/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue({}),
}));

const schoolService = require('../school.service');
const schoolRouter = require('../school.controller');
const { recordAuditEvent } = require('../../audit/audit.service');

const SCHOOL_ID = 'school-entity-archive-controller-test';
const AUTHORITY = {
  userId: 'authority-test',
  roles: ['school_authority'],
  tenantId: SCHOOL_ID,
};

function routeHandler(method, path) {
  const layer = schoolRouter.stack.find((entry) => (
    entry.route?.path === path && entry.route.methods[method]
  ));
  if (!layer) throw new Error(`School archive ${method.toUpperCase()} route was not registered.`);
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

describe('School Authority class and student archive routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restores a student and audits the restore only after service success', async () => {
    jest.spyOn(schoolService, 'restoreSchoolEntity').mockResolvedValue({
      studentId: 'STU-1',
      status: 'active',
    });
    const req = {
      params: { schoolId: SCHOOL_ID, entityType: 'students', entityId: 'STU-1' },
      user: AUTHORITY,
    };
    const res = createResponse();

    await routeHandler('post', '/:schoolId/entities/:entityType/:entityId/restore')(req, res);

    expect(schoolService.restoreSchoolEntity).toHaveBeenCalledWith(
      SCHOOL_ID,
      'students',
      'STU-1',
      AUTHORITY,
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: SCHOOL_ID,
      actorId: AUTHORITY.userId,
      action: 'student.restored',
      resourceType: 'student',
      resourceId: 'STU-1',
    }));
    expect(res.json).toHaveBeenCalledWith({
      status: 'ok',
      entity: { studentId: 'STU-1', status: 'active' },
    });
  });

  it('requires the permanent-delete operation and records a distinct audit action', async () => {
    jest.spyOn(schoolService, 'deleteEntity').mockResolvedValue({
      classId: 'CLASS-1',
      permanentlyDeleted: true,
    });
    const req = {
      params: { schoolId: SCHOOL_ID, entityType: 'classes', entityId: 'CLASS-1' },
      body: { confirmation: 'CLASS-1' },
      user: AUTHORITY,
    };
    const res = createResponse();

    await routeHandler('delete', '/:schoolId/entities/:entityType/:entityId/permanent')(req, res);

    expect(schoolService.deleteEntity).toHaveBeenCalledWith(
      SCHOOL_ID,
      'classes',
      'CLASS-1',
      AUTHORITY,
      { confirmation: 'CLASS-1', permanent: true },
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: SCHOOL_ID,
      actorId: AUTHORITY.userId,
      action: 'class.permanently_deleted',
      resourceType: 'class',
      resourceId: 'CLASS-1',
      metadata: { permanent: true },
    }));
  });

  it('routes status-based class archival through the archive service and audits the lifecycle action', async () => {
    jest.spyOn(schoolService, 'getSchoolBySchoolId').mockResolvedValue({
      classes: [{ classId: 'CLASS-2', status: 'active' }],
    });
    jest.spyOn(schoolService, 'deleteEntity').mockResolvedValue({
      classId: 'CLASS-2',
      status: 'archived',
    });
    const updateEntity = jest.spyOn(schoolService, 'updateEntity').mockResolvedValue({});
    const req = {
      params: { schoolId: SCHOOL_ID, entityType: 'classes', entityId: 'CLASS-2' },
      body: { status: 'archived' },
      user: AUTHORITY,
    };
    const res = createResponse();

    await routeHandler('put', '/:schoolId/entities/:entityType/:entityId')(req, res);

    expect(schoolService.deleteEntity).toHaveBeenCalledWith(
      SCHOOL_ID,
      'classes',
      'CLASS-2',
      AUTHORITY,
      { confirmation: undefined },
    );
    expect(updateEntity).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'class.archived',
      resourceType: 'class',
      resourceId: 'CLASS-2',
    }));
  });
});
