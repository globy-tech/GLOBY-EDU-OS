// tenant.middleware.js
// Enforce tenant isolation: ensure the authenticated user belongs to the requested school
// or is a super_admin. Attach tenant context to the request.

const { roleGuard } = require('../../auth/middleware/role.middleware');
const prisma = require('../../../config/prisma.client');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');
const schoolService = require('../school.service');
const { resolveTenantFromHostname } = require('../tenant-hostname');
const {
  loadSchoolData,
} = require('../fallback.school');

async function tenantMiddleware(req, res, next) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: 'error', message: 'Authentication required' });

    let requestedSchoolId = req.params.schoolId || req.body?.schoolId || user.schoolId || '';
    if (!requestedSchoolId && user.tenantId) {
      if (firebaseData.isFirebaseDataConfigured() || prisma?.__stub) {
        requestedSchoolId = user.tenantId;
      } else {
        const userTenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } }).catch(() => null);
        requestedSchoolId = userTenant?.schoolId || '';
      }
    }
    const fallbackSchools = process.env.NODE_ENV !== 'production' && prisma?.__stub ? loadSchoolData() : [];
    const hostMatch = resolveTenantFromHostname(req.headers?.host || req.hostname || '', fallbackSchools);

    if (user.status && ['suspended', 'inactive', 'blocked', 'disabled'].includes(String(user.status).trim().toLowerCase())) {
      return res.status(403).json({ status: 'error', code: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact your school administrator.' });
    }

    if (user.passwordNeedsReset === true && req.path !== '/change-password') {
      return res.status(403).json({ status: 'error', code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your temporary password before continuing.' });
    }

    const roles = Array.isArray(user?.roles)
      ? user.roles
      : typeof user?.roles === 'string'
        ? [user.roles]
        : [];

    const hasSuperAdminRole = roles.some((role) => String(role).trim().toLowerCase() === 'super_admin');
    const isPlatformAdmin = hasSuperAdminRole && user.platformAdmin === true && !user.tenantId && !user.schoolId;
    if (hasSuperAdminRole && !isPlatformAdmin) {
      return res.status(403).json({ status: 'error', message: 'Platform administrator record is invalid.' });
    }
    if (isPlatformAdmin) return next();

    if (!requestedSchoolId && hostMatch) {
      req.params = req.params || {};
      req.params.schoolId = hostMatch.schoolId;
    }

    if (!requestedSchoolId && !hostMatch) {
      return res.status(400).json({ status: 'error', message: 'School ID is required' });
    }

    const resolvedSchoolId = req.params.schoolId || req.body?.schoolId || requestedSchoolId || hostMatch?.schoolId;

    if (firebaseData.isFirebaseDataConfigured()) {
      const tenant = await firebaseCore.getSchoolAggregate(resolvedSchoolId).catch(() => null);
      if (!tenant) return res.status(404).json({ status: 'error', message: 'School not found' });
      if (!user.tenantId || user.tenantId !== resolvedSchoolId) {
        return res.status(403).json({ status: 'error', message: 'Tenant mismatch' });
      }
      if (tenant.archivedAt) {
        return res.status(403).json({ status: 'error', code: 'SCHOOL_ARCHIVED', message: 'This school has been archived.' });
      }
      const resolved = schoolService.resolveSchoolLifecycleStatus(tenant);
      if (!schoolService.isSchoolAccessAllowed(resolved)) {
        return denySchoolAccess(res, resolved);
      }
      req.tenant = resolved;
      return next();
    }

    if (prisma && prisma.__stub) {
      const schools = loadSchoolData();
      const school = schools.find((entry) => entry.schoolId === resolvedSchoolId);
      if (!school) return res.status(404).json({ status: 'error', message: 'School not found' });
      if (schoolIdMismatch(user, resolvedSchoolId)) {
        return res.status(403).json({ status: 'error', message: 'Tenant mismatch' });
      }
      if (school.archivedAt) {
        return res.status(403).json({ status: 'error', code: 'SCHOOL_ARCHIVED', message: 'This school has been archived.' });
      }
      const resolved = schoolService.resolveSchoolLifecycleStatus(school);
      if (!schoolService.isSchoolAccessAllowed(resolved)) {
        return denySchoolAccess(res, resolved);
      }
      req.tenant = resolved;
      return next();
    }

    // Ensure the user's tenant matches requested school
    const tenant = await prisma.tenant.findUnique({ where: { schoolId: resolvedSchoolId } }).catch(() => null);
    if (!tenant) return res.status(404).json({ status: 'error', message: 'School not found' });

    if (tenant.id !== user.tenantId) {
      return res.status(403).json({ status: 'error', message: 'Tenant mismatch' });
    }

    if (tenant.archivedAt) {
      return res.status(403).json({ status: 'error', code: 'SCHOOL_ARCHIVED', message: 'This school has been archived.' });
    }
    const resolvedTenant = schoolService.resolveSchoolLifecycleStatus(tenant);
    if (!schoolService.isSchoolAccessAllowed(resolvedTenant)) {
      return denySchoolAccess(res, resolvedTenant);
    }

    // Attach tenant info for downstream handlers
    req.tenant = resolvedTenant;
    return next();
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Tenant check failed' });
  }
}

function denySchoolAccess(res, school) {
  const operationalStatus = String(school.schoolStatus || school.status || '').trim().toLowerCase();
  if (operationalStatus !== 'active') {
    return res.status(403).json({ status: 'error', code: 'SCHOOL_SUSPENDED', message: 'This school is operationally suspended.' });
  }
  return res.status(403).json({ status: 'error', code: 'SUBSCRIPTION_EXPIRED', message: 'This school subscription is expired or unavailable.' });
}

function schoolIdMismatch(user, requestedSchoolId) {
  return !user.tenantId || user.tenantId !== requestedSchoolId;
}

module.exports = tenantMiddleware;
