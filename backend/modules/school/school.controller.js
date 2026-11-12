// school.controller.js
// Express handlers for school (tenant) management API.

const express = require('express');
const router = express.Router();
const schoolService = require('./school.service');
const admissionsService = require('./admissions.service');
const academicProgressionService = require('./academic-progression.service');
const authMiddleware = require('../auth/middleware/auth.middleware');
const { roleGuard } = require('../auth/middleware/role.middleware');
const tenantMiddleware = require('./middleware/tenant.middleware');
const { listAuditEvents, recordAuditEvent } = require('../audit/audit.service');

const SCHOOL_AUTHORITY_UPDATE_FIELDS = new Set([
  'name',
  'email',
  'phone',
  'website',
  'country',
  'region',
  'city',
  'schoolType',
  'schoolLevel',
  'motto',
  'description',
  'address',
  'timezone',
  'logo',
  'logoPath',
  'coverImage',
  'coverImagePath',
  'stamp',
  'stampPath',
  'principalSignature',
  'principalSignaturePath',
  'branding',
  'settings',
  'academicStructure',
  'announcements',
  'messages',
  'reports',
  'events',
  'recentActivities',
  'financeCategories',
  'examRecords',
  'examResults',
  'reportCards',
  'transcripts',
  'academicYear',
  'currentTerm',
]);

async function auditSchoolAction(req, event) {
  await recordAuditEvent({
    req,
    actorId: req.user?.userId,
    actorRole: req.user?.roles?.[0],
    tenantId: event.tenantId || req.params?.schoolId || req.user?.tenantId,
    ...event,
  });
}

function schoolArchiveErrorStatus(error) {
  if (error?.code === 'SCHOOL_NOT_FOUND') return 404;
  if (['SCHOOL_ALREADY_ARCHIVED', 'SCHOOL_NOT_ARCHIVED', 'SCHOOL_HAS_DEPENDENCIES', 'SCHOOL_ARCHIVED'].includes(error?.code)) return 409;
  return 500;
}

router.get('/:schoolId/admissions', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const admissions = await admissionsService.getAdmissions(req.params.schoolId, req.user || {}, {
      status: req.query.status || '',
    });
    return res.json({ status: 'ok', admissions });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/admissions', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const admission = await admissionsService.createAdmission(req.params.schoolId, req.body || {}, req.user || {});
    await auditSchoolAction(req, {
      action: 'admission.created',
      resourceType: 'admission',
      resourceId: admission.applicationId,
      metadata: { applicationNumber: admission.applicationNumber, status: admission.status },
    });
    return res.status(201).json({ status: 'ok', admission });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.put('/:schoolId/admissions/:admissionId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const admission = await admissionsService.updateAdmission(
      req.params.schoolId,
      req.params.admissionId,
      req.body || {},
      req.user || {},
    );
    await auditSchoolAction(req, {
      action: 'admission.updated',
      resourceType: 'admission',
      resourceId: admission.applicationId,
      metadata: { status: admission.status },
    });
    return res.json({ status: 'ok', admission });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.put('/:schoolId/admissions/:admissionId/decision', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const result = await admissionsService.decideAdmission(
      req.params.schoolId,
      req.params.admissionId,
      req.body || {},
      req.user || {},
    );
    await auditSchoolAction(req, {
      action: result.admission.status === 'approved' ? 'admission.approved_and_enrolled' : 'admission.rejected',
      resourceType: 'admission',
      resourceId: result.admission.applicationId,
      metadata: {
        applicationNumber: result.admission.applicationNumber,
        studentId: result.student?.studentId || null,
        classId: result.admission.classId || null,
        academicYearId: result.admission.academicYearId || null,
        idempotentRetry: result.idempotent === true,
      },
    });
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/progression/preview', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const preview = await academicProgressionService.previewProgression(req.params.schoolId, {
      fromAcademicYearId: req.query.fromAcademicYearId,
      targetAcademicYearId: req.query.targetAcademicYearId,
    }, req.user || {});
    return res.json({ status: 'ok', preview });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/progression/confirm', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const result = await academicProgressionService.confirmProgression(
      req.params.schoolId,
      req.body || {},
      req.user || {},
    );
    await auditSchoolAction(req, {
      action: 'student.progression_completed',
      resourceType: 'academic_progression',
      resourceId: result.operationId,
      metadata: {
        fromAcademicYearId: result.fromAcademicYearId,
        targetAcademicYearId: result.targetAcademicYearId,
        decisions: result.results.reduce((counts, entry) => {
          counts[entry.action] = (counts[entry.action] || 0) + 1;
          return counts;
        }, {}),
        idempotentRetry: result.results.length > 0 && result.results.every((entry) => entry.idempotent),
      },
    });
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/calendar', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'super_admin']), async (req, res) => {
  try {
    const calendar = await schoolService.listSchoolCalendarEvents(req.params.schoolId, req.user || {});
    return res.json({ status: 'ok', ...calendar });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/calendar', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const event = await schoolService.createSchoolCalendarEvent(req.params.schoolId, req.body || {}, req.user || {});
    await auditSchoolAction(req, {
      action: 'school.calendar.event_created',
      resourceType: 'school-calendar-event',
      resourceId: event.id,
      metadata: { type: event.type, startDate: event.startDate, endDate: event.endDate, schoolClosure: event.schoolClosure },
    });
    return res.status(201).json({ status: 'ok', event });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.put('/:schoolId/calendar/:eventId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const event = await schoolService.updateSchoolCalendarEvent(
      req.params.schoolId,
      req.params.eventId,
      req.body || {},
      req.user || {},
    );
    await auditSchoolAction(req, {
      action: 'school.calendar.event_updated',
      resourceType: 'school-calendar-event',
      resourceId: event.id,
      metadata: { type: event.type, startDate: event.startDate, endDate: event.endDate, schoolClosure: event.schoolClosure, status: event.status },
    });
    return res.json({ status: 'ok', event });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/attendance-tasks', authMiddleware, tenantMiddleware, roleGuard(['teacher']), async (req, res) => {
  try {
    const tasks = await schoolService.getTeacherAttendanceTasks(req.params.schoolId, req.user || {}, req.query.date);
    return res.json({ status: 'ok', ...tasks });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/schools - Super Admin only
router.post('/', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const payload = req.body || {};
    // Basic validation
    if (!payload.name) return res.status(400).json({ status: 'error', message: 'School name required' });
    const school = await schoolService.createSchool(payload);
    await auditSchoolAction(req, { action: 'school.created', resourceType: 'school', resourceId: school.schoolId || school.id, tenantId: school.schoolId || school.id });
    return res.status(201).json({ status: 'ok', school });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools - Super Admin only
router.get('/', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const search = req.query.search || '';
    const list = await schoolService.listSchools(search);
    return res.json({ status: 'ok', schools: list });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/summary - Super Admin only
router.get('/summary', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const summary = await schoolService.getPlatformSummary({ days: req.query.days });
    return res.json({ status: 'ok', summary });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/archived - Super Admin only
router.get('/archived', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const schools = await schoolService.listArchivedSchools(req.query.search || '', req.query.status || '');
    return res.json({ status: 'ok', schools });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/archive - Super Admin only
router.post('/:schoolId/archive', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const school = await schoolService.archiveSchool(req.params.schoolId);
    await auditSchoolAction(req, {
      action: 'school.archived',
      resourceType: 'school',
      resourceId: school.schoolId,
      tenantId: school.schoolId,
      metadata: { schoolName: school.name || school.schoolName || null, archivedAt: school.archivedAt },
    });
    return res.json({ status: 'ok', school: schoolService.sanitizeSchoolResponse(school) });
  } catch (err) {
    return res.status(schoolArchiveErrorStatus(err)).json({ status: 'error', code: err.code, message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/restore - Super Admin only
router.post('/:schoolId/restore', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const school = await schoolService.restoreSchool(req.params.schoolId);
    await auditSchoolAction(req, {
      action: 'school.restored',
      resourceType: 'school',
      resourceId: school.schoolId,
      tenantId: school.schoolId,
      metadata: { schoolName: school.name || school.schoolName || null },
    });
    return res.json({ status: 'ok', school: schoolService.sanitizeSchoolResponse(school) });
  } catch (err) {
    return res.status(schoolArchiveErrorStatus(err)).json({ status: 'error', code: err.code, message: err.message });
  }
});

// DELETE /api/v1/schools/:schoolId/permanent - archived schools only, Super Admin only
router.delete('/:schoolId/permanent', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const deleted = await schoolService.permanentlyDeleteArchivedSchool(req.params.schoolId);
    await auditSchoolAction(req, {
      action: 'school.permanently_deleted',
      resourceType: 'school',
      resourceId: deleted.schoolId,
      tenantId: deleted.schoolId,
      metadata: { schoolName: deleted.name || null },
    });
    return res.json({ status: 'ok', school: deleted });
  } catch (err) {
    return res.status(schoolArchiveErrorStatus(err)).json({ status: 'error', code: err.code, message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/credentials - Super Admin only
router.post('/:schoolId/credentials', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const credentials = await schoolService.updateSchoolCredentials(req.params.schoolId, req.body || {});
    await auditSchoolAction(req, { action: 'school.credentials_changed', resourceType: 'school', resourceId: req.params.schoolId });
    return res.json({ status: 'ok', credentials });
  } catch (err) {
    return res.status(err.message === 'School not found' ? 404 : 400).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/:schoolId/messages - Tenant-scoped workspace messages
router.get('/:schoolId/messages', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const response = await schoolService.listWorkspaceMessages(schoolId, req.query || {}, req.user);
    return res.json({ status: 'ok', schoolId, messages: response.items, total: response.total });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/message-recipients', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const school = await schoolService.getSchoolBySchoolId(req.params.schoolId);
    if (!school) return res.status(404).json({ status: 'error', message: 'School not found' });
    return res.json({ status: 'ok', recipients: schoolService.getMessagingRecipientOptions(school, req.user) });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/assignments', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const result = req.user?.roles?.includes('student')
      ? await schoolService.listAssignmentsForStudent(schoolId, req.query || {}, req.user)
      : await schoolService.listAssignments(schoolId, req.query || {}, req.user);
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/activity', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority']), async (req, res) => {
  try {
    const activity = await listAuditEvents({
      tenantId: req.params.schoolId,
      actorRole: 'teacher',
      limit: req.query.limit || 100,
    });
    const activityEntries = activity
      .filter((entry) => entry.action?.startsWith('teacher.') || ['student.created', 'student.updated', 'student.archived'].includes(entry.action))
      .map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorId: entry.actorId,
        createdAt: entry.createdAt,
        metadata: Object.fromEntries(['title', 'className', 'subject', 'recordCount', 'date', 'recipientCount']
          .filter((key) => entry.metadata?.[key] !== undefined)
          .map((key) => [key, entry.metadata[key]])),
      }));
    return res.json({ status: 'ok', activity: activityEntries });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Unable to load teacher activity.' });
  }
});

router.post('/:schoolId/assignments', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'super_admin']), async (req, res) => {
  try {
    const assignment = await schoolService.createAssignment(req.params.schoolId, req.body || {}, req.user);
    if (req.user?.roles?.includes('teacher')) {
      await auditSchoolAction(req, {
        action: 'teacher.assignment.created',
        resourceType: 'assignment',
        resourceId: assignment.id,
        metadata: { title: assignment.title, className: assignment.className, subject: assignment.subject },
      });
    }
    return res.status(201).json({ status: 'ok', assignment });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/assignments/:assignmentId/submissions', authMiddleware, tenantMiddleware, roleGuard(['student']), async (req, res) => {
  try {
    const assignment = await schoolService.submitAssignment(req.params.schoolId, req.params.assignmentId, req.body || {}, req.user);
    return res.json({ status: 'ok', assignment });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/lessons', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const result = req.user?.roles?.includes('student')
      ? await schoolService.listLessonsForStudent(schoolId, req.query || {}, req.user)
      : await schoolService.listLessons(schoolId, req.query || {}, req.user);
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/lessons', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'super_admin']), async (req, res) => {
  try {
    const lesson = await schoolService.createLesson(req.params.schoolId, req.body || {}, req.user);
    if (req.user?.roles?.includes('teacher')) {
      await auditSchoolAction(req, {
        action: 'teacher.lesson.created',
        resourceType: 'lesson',
        resourceId: lesson.id,
        metadata: { title: lesson.title, className: lesson.className, subject: lesson.subject },
      });
    }
    return res.status(201).json({ status: 'ok', lesson });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/messages - Tenant-scoped workspace messages
router.post('/:schoolId/messages', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const payload = req.body || {};
    const message = await schoolService.createWorkspaceMessage(schoolId, payload, req.user);
    await auditSchoolAction(req, {
      action: req.user?.roles?.includes('teacher') ? 'teacher.message.sent' : 'message.sent',
      resourceType: 'message',
      resourceId: message.id,
      ...(req.user?.roles?.includes('teacher') ? { metadata: { recipientCount: Array.isArray(payload.recipientIds) ? payload.recipientIds.length : 1 } } : {}),
    });
    return res.status(201).json({ status: 'ok', message });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// PUT /api/v1/schools/:schoolId/messages/:messageId - Tenant-scoped workspace message updates
router.put('/:schoolId/messages/:messageId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, messageId } = req.params;
    const message = await schoolService.updateWorkspaceMessage(schoolId, messageId, req.body || {}, req.user);
    if (req.user?.roles?.includes('teacher')) {
      await auditSchoolAction(req, { action: 'teacher.message.updated', resourceType: 'message', resourceId: messageId });
    }
    return res.json({ status: 'ok', message });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/v1/schools/:schoolId/messages/:messageId - Tenant-scoped workspace message removal
router.delete('/:schoolId/messages/:messageId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, messageId } = req.params;
    const message = await schoolService.deleteWorkspaceMessage(schoolId, messageId, req.user);
    if (req.user?.roles?.includes('teacher')) {
      await auditSchoolAction(req, { action: 'teacher.message.deleted', resourceType: 'message', resourceId: messageId });
    }
    return res.json({ status: 'ok', message });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/:schoolId/support-tickets - Tenant-scoped support tickets
router.get('/:schoolId/support-tickets', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const response = await schoolService.listSupportTickets(schoolId, req.query || {});
    return res.json({ status: 'ok', schoolId, tickets: response.items, total: response.total });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/support-tickets - Tenant-scoped support ticket creation
router.post('/:schoolId/support-tickets', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const ticket = await schoolService.createSupportTicket(schoolId, req.body || {});
    return res.status(201).json({ status: 'ok', ticket });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// PUT /api/v1/schools/:schoolId/support-tickets/:ticketId - Tenant-scoped support ticket updates
router.put('/:schoolId/support-tickets/:ticketId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, ticketId } = req.params;
    const ticket = await schoolService.updateSupportTicket(schoolId, ticketId, req.body || {});
    return res.json({ status: 'ok', ticket });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/v1/schools/:schoolId/support-tickets/:ticketId - Tenant-scoped support ticket removal
router.delete('/:schoolId/support-tickets/:ticketId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, ticketId } = req.params;
    const ticket = await schoolService.deleteSupportTicket(schoolId, ticketId);
    return res.json({ status: 'ok', ticket });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/:schoolId - School Admin or Super Admin
router.get('/:schoolId', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const school = await schoolService.getSchoolBySchoolId(schoolId);
    if (!school) return res.status(404).json({ status: 'error', message: 'School not found' });
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const responseSchool = roles.includes('teacher')
      ? schoolService.getTeacherSchoolView(school, req.user)
      : roles.includes('student')
        ? schoolService.getStudentSchoolView(school, req.user)
        : schoolService.sanitizeSchoolResponse(school);
    const response = { status: 'ok', school: responseSchool };
    if (roles.some((role) => ['school_authority', 'school_head', 'super_admin'].includes(String(role).toLowerCase()))) {
      response.summary = await schoolService.getDashboardSummary(schoolId, school);
    }
    return res.json(response);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Unable to load school details.' });
  }
});

// POST /api/v1/schools/:schoolId/payments - authorized school finance users only
router.post('/:schoolId/payments', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const result = await schoolService.createFeePayment(req.params.schoolId, req.body || {}, req.user || {});
    await auditSchoolAction(req, { action: 'payment.created', resourceType: 'payment', resourceId: result.payment.id });
    return res.status(201).json({ status: 'ok', payment: result.payment, receipt: result.receipt });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/invoices', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const invoices = await schoolService.listSchoolInvoices(req.params.schoolId, req.user || {});
    return res.json({ status: 'ok', invoices });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/invoices', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const idempotencyKey = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
    const invoice = await schoolService.createSchoolInvoice(req.params.schoolId, req.body || {}, req.user || {}, idempotencyKey);
    await auditSchoolAction(req, { action: 'invoice.created', resourceType: 'invoice', resourceId: invoice.id });
    return res.status(201).json({ status: 'ok', invoice });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.patch('/:schoolId/invoices/:invoiceId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const invoice = await schoolService.cancelSchoolInvoice(req.params.schoolId, req.params.invoiceId, req.body || {}, req.user || {});
    await auditSchoolAction(req, { action: 'invoice.cancelled', resourceType: 'invoice', resourceId: invoice.id });
    return res.json({ status: 'ok', invoice });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/invoices/:invoiceId/checkout', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const idempotencyKey = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
    const payment = await schoolService.initializeInvoicePayment(
      req.params.schoolId,
      req.params.invoiceId,
      req.user || {},
      idempotencyKey,
    );
    await auditSchoolAction(req, {
      action: 'invoice.payment.checkout.started',
      resourceType: 'invoice',
      resourceId: req.params.invoiceId,
      metadata: { paymentReference: payment.reference },
    });
    return res.status(201).json({ status: 'ok', payment });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/invoices/:invoiceId/verify-payment', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const idempotencyKey = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
    const result = await schoolService.verifyAndLinkInvoicePayment(
      req.params.schoolId,
      req.params.invoiceId,
      req.body || {},
      req.user || {},
      idempotencyKey,
    );
    if (!result.alreadyLinked) {
      await auditSchoolAction(req, {
        action: 'invoice.payment.verified',
        resourceType: 'invoice',
        resourceId: result.invoice.id,
        metadata: { paymentReference: result.invoice.paymentReference },
      });
    }
    return res.json({
      status: 'ok',
      ...result,
      message: result.alreadyLinked ? 'This verified payment is already linked to the invoice.' : 'Payment verified and linked to the invoice.',
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.get('/:schoolId/refund-requests', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const refunds = await schoolService.listSchoolRefundRequests(req.params.schoolId, req.user || {});
    return res.json({ status: 'ok', refunds });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/refund-requests', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const idempotencyKey = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
    const refund = await schoolService.createSchoolRefundRequest(req.params.schoolId, req.body || {}, req.user || {}, idempotencyKey);
    await auditSchoolAction(req, { action: 'refund.requested', resourceType: 'refund-request', resourceId: refund.id });
    return res.status(201).json({ status: 'ok', refund, message: 'Refund request submitted for review. No payment has been refunded.' });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ status: 'error', message: err.message });
  }
});

// PUT /api/v1/schools/:schoolId - School Head (own school), teacher workspace, or Super Admin
router.put('/:schoolId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'super_admin']), async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const payload = req.body || {};
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (['payments', 'receipts', 'invoices', 'refunds'].some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
      return res.status(403).json({ status: 'error', message: 'Payments, receipts, invoices, and refund requests must use their dedicated finance endpoints.' });
    }
    if (Array.isArray(payload.events) && payload.events.some((event) => event?.kind === 'school_calendar')) {
      return res.status(403).json({ status: 'error', message: 'School calendar entries must use the validated calendar endpoints.' });
    }
    const subscriptionFields = new Set(['subscriptionPlan', 'subscriptionStatus', 'expiresAt', 'trialEndsAt', 'trialStatus', 'billingPeriod', 'studentLimit']);
    if (!(req.user?.platformAdmin === true && roles.includes('super_admin')) &&
        Object.keys(payload).some((field) => subscriptionFields.has(field))) {
      return res.status(403).json({ status: 'error', message: 'Subscription changes require verified payment or platform-admin authorization.' });
    }
    if (roles.some((role) => ['school_authority', 'school_head'].includes(String(role).toLowerCase())) &&
        Object.prototype.hasOwnProperty.call(payload, 'attendanceRecords')) {
      return res.status(403).json({ status: 'error', message: 'Attendance can only be recorded by authorized teachers.' });
    }
    const isSchoolAuthority = roles.some((role) => ['school_authority', 'school_head'].includes(String(role).toLowerCase()));
    if (isSchoolAuthority && Object.keys(payload).some((field) => !SCHOOL_AUTHORITY_UPDATE_FIELDS.has(field))) {
      return res.status(403).json({
        status: 'error',
        message: 'This school update is not permitted. Use an authorized school workflow.',
      });
    }
    const school = await schoolService.getSchoolBySchoolId(schoolId);
    if (!school) return res.status(404).json({ status: 'error', message: 'School not found' });
    if (req.user?.roles?.includes('teacher')) {
      const allowedKeys = new Set(['attendanceRecords', 'examResults', 'teacherProfile']);
      if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
        return res.status(403).json({ status: 'error', message: 'Teachers can only update assigned workspace records.' });
      }
      const updatedTeacherWorkspace = schoolService.updateTeacherWorkspace(school, req.user, payload);
      const persisted = await schoolService.updateSchool(school.id, {
        attendanceRecords: updatedTeacherWorkspace.attendanceRecords,
        examResults: updatedTeacherWorkspace.examResults,
        teachers: updatedTeacherWorkspace.teachers,
        users: updatedTeacherWorkspace.users,
        recentActivities: school.recentActivities,
      });
      if (Object.prototype.hasOwnProperty.call(payload, 'attendanceRecords')) {
        const records = Array.isArray(payload.attendanceRecords) ? payload.attendanceRecords : [];
        await auditSchoolAction(req, {
          action: 'teacher.attendance.updated',
          resourceType: 'attendance',
          metadata: { recordCount: records.length, date: records[0]?.date || null },
        });
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'examResults')) {
        const records = Array.isArray(payload.examResults) ? payload.examResults : [];
        await auditSchoolAction(req, {
          action: 'teacher.marks.updated',
          resourceType: 'examResults',
          metadata: { recordCount: records.length },
        });
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'teacherProfile')) {
        await auditSchoolAction(req, { action: 'teacher.profile.updated', resourceType: 'teacherProfile' });
      }
      return res.json({ status: 'ok', school: schoolService.getTeacherSchoolView(persisted, req.user) });
    }
    const updated = await schoolService.updateSchool(school.id, payload);
    return res.json({ status: 'ok', school: schoolService.sanitizeSchoolResponse(updated) });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/v1/schools/:schoolId - Super Admin only (soft suspend)
router.delete('/:schoolId', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const school = await schoolService.getSchoolBySchoolId(schoolId);
    if (!school) return res.status(404).json({ status: 'error', message: 'School not found' });
    const suspended = await schoolService.deleteSchool(school.id);
    await auditSchoolAction(req, { action: 'school.suspended', resourceType: 'school', resourceId: schoolId });
    return res.json({ status: 'ok', school: schoolService.sanitizeSchoolResponse(suspended) });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/activate - Super Admin only
router.post('/:schoolId/activate', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const school = await schoolService.getSchoolBySchoolId(schoolId);
    if (!school) return res.status(404).json({ status: 'error', message: 'School not found' });
    const activated = await schoolService.activateSchool(school.id);
    await auditSchoolAction(req, { action: 'school.activated', resourceType: 'school', resourceId: schoolId });
    return res.json({ status: 'ok', school: activated });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/:schoolId/entities/:entityType - Tenant-scoped School Head entity list
router.get('/:schoolId/entities/:entityType', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, entityType } = req.params;
    const query = {
      search: req.query.search || '',
      status: req.query.status || '',
      page: req.query.page || 1,
      pageSize: req.query.pageSize || 20,
    };
    const response = await schoolService.getEntities(schoolId, entityType, query, req.user);
    return res.json({ status: 'ok', entityType, ...response });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/schools/:schoolId/entities/:entityType - Tenant-scoped create entity
router.post('/:schoolId/entities/:entityType', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, entityType } = req.params;
    const payload = req.body || {};
    const entity = await schoolService.createEntity(schoolId, entityType, payload, req.user);
    if (['students', 'teachers'].includes(entityType)) {
      await auditSchoolAction(req, { action: `${entityType.slice(0, -1)}.created`, resourceType: entityType.slice(0, -1), resourceId: entity?.id || entity?.teacherId || entity?.studentId || entity?.email });
    } else if (entityType === 'classes') {
      await auditSchoolAction(req, {
        action: 'class.created',
        resourceType: 'class',
        resourceId: entity?.classId || entity?.id,
        metadata: { name: entity?.name, academicYearId: entity?.academicYearId || null },
      });
    }
    return res.status(201).json({ status: 'ok', entity });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/teachers/:teacherId/resend-invitation', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const result = await schoolService.resendFirebaseTeacherInvitation(
      req.params.schoolId,
      req.params.teacherId,
      req.user,
    );
    await auditSchoolAction(req, {
      action: 'teacher.invitation_resent',
      resourceType: 'teacher',
      resourceId: result.teacherId,
      metadata: { invitationStatus: result.invitationStatus },
    });
    return res.json({
      status: 'ok',
      invitationStatus: result.invitationStatus,
      invitationEmailStatus: result.invitationEmailStatus,
      invitationEmailDeliveryStatus: result.invitationEmailDeliveryStatus,
      expiresAt: result.invitationExpiresAt || null,
    });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// PUT /api/v1/schools/:schoolId/entities/:entityType/:entityId - Tenant-scoped edit entity
router.put('/:schoolId/entities/:entityType/:entityId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'teacher', 'student', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, entityType, entityId } = req.params;
    const updates = req.body || {};
    const entity = await schoolService.updateEntity(schoolId, entityType, entityId, updates, req.user);
    if (['students', 'teachers'].includes(entityType)) {
      await auditSchoolAction(req, { action: `${entityType.slice(0, -1)}.updated`, resourceType: entityType.slice(0, -1), resourceId: entityId });
    } else if (entityType === 'classes') {
      await auditSchoolAction(req, {
        action: Object.keys(updates).some((field) => ['teacherId', 'teacherIds', 'teachers', 'teacher', 'classTeacher'].includes(field))
          ? 'class.teacher_assignment.updated'
          : 'class.updated',
        resourceType: 'class',
        resourceId: entityId,
        metadata: { name: entity?.name, academicYearId: entity?.academicYearId || null },
      });
    }
    return res.json({ status: 'ok', entity });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.post('/:schoolId/entities/students/:studentId/deletion-request', authMiddleware, tenantMiddleware, roleGuard(['teacher']), async (req, res) => {
  try {
    const result = await schoolService.requestStudentDeletion(
      req.params.schoolId,
      req.params.studentId,
      req.body?.reason,
      req.user || {},
    );
    await auditSchoolAction(req, {
      action: 'student.deletion_requested',
      resourceType: 'student',
      resourceId: result.studentId,
    });
    return res.status(201).json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

router.put('/:schoolId/entities/students/:studentId/deletion-request', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { decision, confirmation } = req.body || {};
    const result = await schoolService.resolveStudentDeletionRequest(
      req.params.schoolId,
      req.params.studentId,
      decision,
      confirmation,
      req.user || {},
    );
    await auditSchoolAction(req, {
      action: result.status === 'approved' ? 'student.deletion_approved' : 'student.deletion_rejected',
      resourceType: 'student',
      resourceId: result.studentId,
    });
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/v1/schools/:schoolId/entities/:entityType/:entityId - Tenant-scoped remove entity
router.delete('/:schoolId/entities/:entityType/:entityId', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { schoolId, entityType, entityId } = req.params;
    const entity = await schoolService.deleteEntity(schoolId, entityType, entityId, req.user, {
      confirmation: req.body?.confirmation,
    });
    if (['students', 'teachers'].includes(entityType)) {
      await auditSchoolAction(req, { action: `${entityType.slice(0, -1)}.archived`, resourceType: entityType.slice(0, -1), resourceId: entityId });
    }
    return res.json({ status: 'ok', entity });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/:schoolId/search - Tenant-scoped global search across school data
router.get('/:schoolId/search', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const { schoolId } = req.params;
    const search = req.query.term || req.query.search || '';
    const scope = req.query.scope || '';
    if (!search) return res.status(400).json({ status: 'error', message: 'Search term is required' });
    const results = await schoolService.searchEntities(schoolId, search, scope);
    return res.json({ status: 'ok', search, scope, results });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/v1/schools/:schoolId/summary - Tenant-scoped dashboard summary
router.get('/:schoolId/summary', authMiddleware, tenantMiddleware, roleGuard(['school_head', 'school_authority', 'super_admin']), async (req, res) => {
  try {
    const schoolId = req.params.schoolId;
    const summary = await schoolService.getDashboardSummary(schoolId);
    return res.json({ status: 'ok', summary });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Unable to load the school dashboard summary.' });
  }
});

module.exports = router;
