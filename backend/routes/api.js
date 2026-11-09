// api.js
// Modular API router for backend routes used by GlobyEdu OS.
// This file wires health checks, authentication, and placeholder routes into a single router.

const express = require('express');
const authRoutes = require('./auth');
const fileRoutes = require('./files');
const accountProfileRoutes = require('./account-profile');
const websiteCmsRoutes = require('./website-cms');
const schoolRoutes = require('../modules/school/school.routes');
const authMiddleware = require('../modules/auth/middleware/auth.middleware');
const { roleGuard } = require('../modules/auth/middleware/role.middleware');
const { listAuditEvents } = require('../modules/audit/audit.service');
const router = express.Router();

// Health check endpoint used by the frontend and automated monitoring.
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'GlobyEdu API is healthy and running.',
  });
});

// Attach the authentication router to /api/v1/auth.
router.use('/auth', authRoutes);

// Attach tenant-scoped Supabase storage routes to /api/v1/files.
router.use('/files', fileRoutes);
router.use('/account-profile', accountProfileRoutes);
router.use('/website-cms', websiteCmsRoutes);

// Attach the curriculum router to /api/v1/curriculum.
const curriculumRoutes = require('./curriculum');
router.use('/curriculum', curriculumRoutes);

// Attach school/tenant management routes to /api/v1/schools
router.use('/schools', schoolRoutes);

// Platform administration routes for managing super admins.
const platformAdminRoutes = require('../modules/platform-admin/platform-admin.routes');
router.use('/platform-admins', platformAdminRoutes);

const pricingRoutes = require('../modules/pricing/pricing.routes');
const contactRoutes = require('./contact');
router.use('/pricing', pricingRoutes);
router.use('/contact', contactRoutes);

router.get('/audit-logs', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const auditLogs = await listAuditEvents({
      isSuperAdmin: true,
      limit: req.query.limit,
      actorRole: req.query.role,
      action: req.query.action,
      success: req.query.success,
      since: req.query.since,
    });
    return res.json({ status: 'ok', auditLogs });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Unable to load audit logs.' });
  }
});

module.exports = router;
