// auth.middleware.js
// Express middleware to protect routes using JWT access tokens.

const { verifyAccessToken } = require('../utils/token');
const { isAccessTokenRevoked } = require('../utils/access-token-revocation');
const firebaseAdmin = require('../../../firebase.admin');
const firebaseData = require('../../../firebase.data');
const firebaseCore = require('../../../firebase.core');
const prisma = require('../../../config/prisma.client');
const { loadSchoolData } = require('../../school/fallback.school');
const { findFallbackUser, findFallbackUserByPayload } = require('./fallback-user');

function parseMockToken(token) {
  if (!token || !token.startsWith('mock-jwt-')) return null;
  try {
    const payload = Buffer.from(token.slice('mock-jwt-'.length), 'base64').toString('utf8');
    const [schoolId, username] = payload.split(':');
    if (!schoolId || !username) return null;
    return { schoolId, username };
  } catch (err) {
    return null;
  }
}

function isFallbackLocalToken(payload) {
  if (!payload || typeof payload.userId !== 'string') return false;
  if (!payload.tenantId) return false;
  return payload.userId.includes(':') && payload.roles && Array.isArray(payload.roles);
}

function enforceAccountStatus(req, res, user) {
  const status = String(user?.status || 'active').trim().toLowerCase();
  const isSuspended = status === 'suspended' || status === 'inactive' || status === 'blocked' || status === 'disabled';
  if (isSuspended) {
    return res.status(403).json({
      status: 'error',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your account has been suspended. Please contact your school administrator.',
    });
  }
  return false;
}

function enforcePasswordChange(req, res, user) {
  if (user?.passwordNeedsReset !== true) return false;
  const allowedPaths = ['/change-password', '/logout'];
  if (allowedPaths.includes(req.path)) return false;
  res.status(403).json({
    status: 'error',
    code: 'PASSWORD_CHANGE_REQUIRED',
    message: 'You must change your temporary password before continuing.',
  });
  return true;
}

async function enforceMaintenanceMode(req, res, user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const isPlatformAdmin = roles.some((role) => String(role).trim().toLowerCase() === 'super_admin') &&
    user.platformAdmin === true && !user.tenantId && !user.schoolId;
  if (isPlatformAdmin) return false;

  const isAuthRoute = String(req.baseUrl || '').endsWith('/auth');
  if (isAuthRoute && ['/logout', '/change-password'].includes(req.path)) return false;

  let maintenanceMode;
  try {
    maintenanceMode = await firebaseCore.getMaintenanceMode();
  } catch {
    res.status(503).json({
      status: 'error',
      code: 'MAINTENANCE_MODE',
      message: 'Platform access is temporarily unavailable while maintenance status is checked.',
    });
    return true;
  }
  if (!maintenanceMode) return false;

  res.status(503).json({
    status: 'error',
    code: 'MAINTENANCE_MODE',
    message: 'GlobyEdu is temporarily unavailable while scheduled maintenance is in progress.',
  });
  return true;
}

async function resolveFirebaseUser(decodedToken) {
  const email = String(decodedToken.email || '').trim().toLowerCase();
  if (!email) return null;

  if (firebaseData.isFirebaseDataConfigured()) {
    const snapshot = await firebaseData.getFirestore().collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    const user = snapshot.docs[0].data();
    const roles = (Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean))
      .map((role) => String(role).trim().toLowerCase());
    const claimRoles = Array.isArray(decodedToken.roles) ? decodedToken.roles : [];
    const hasPlatformAdminClaims = decodedToken.role === 'super_admin' ||
      decodedToken.platformAdmin === true || claimRoles.includes('super_admin');
    if (user.status !== 'active' || !decodedToken.uid ||
        ![user.firebaseUid, user.googleUid].filter(Boolean).includes(decodedToken.uid) ||
        roles.some((role) => !claimRoles.includes(role)) ||
        (user.tenantId || user.schoolId) !== decodedToken.tenantId) return null;
    if (roles.includes('super_admin')) {
      if (user.platformAdmin !== true || user.tenantId || user.schoolId ||
          decodedToken.role !== 'super_admin' || decodedToken.platformAdmin !== true) return null;
    } else if (hasPlatformAdminClaims) {
      return null;
    }
    const userId = snapshot.docs[0].id;
    return {
      userId,
      tenantId: user.tenantId || user.schoolId,
      roles,
      platformAdmin: user.platformAdmin === true && roles.includes('super_admin'),
      passwordNeedsReset: user.passwordNeedsReset === true,
    };
  }

  if (prisma && !prisma.__stub) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'active') return null;
    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } });
    return {
      userId: user.id,
      tenantId: user.tenantId,
      roles: roles.map((entry) => entry.role.name),
      platformAdmin: roles.some((entry) => entry.role.name === 'super_admin'),
    };
  }

  const schools = loadSchoolData();
  for (const school of schools) {
    const user = (school.users || []).find((entry) => {
      return String(entry.username || entry.email || '').trim().toLowerCase() === email;
    });
    if (user && user.status === 'active' && user.emailVerified === true) {
      return {
        userId: `${school.schoolId}:${user.username}`,
        tenantId: school.schoolId,
        roles: [user.role],
        platformAdmin: user.platformAdmin === true,
      };
    }
  }

  return null;
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Authorization required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyAccessToken(token);
    if (isAccessTokenRevoked(token)) {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
    }
    const fallbackLocalToken = isFallbackLocalToken(payload);

    if (firebaseData.isFirebaseDataConfigured()) {
      if (!payload.userId || !payload.sessionId) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
      }
      const firestore = firebaseData.getFirestore();
      const [userSnapshot, sessionSnapshot] = await Promise.all([
        firestore.collection('users').doc(String(payload.userId)).get(),
        firestore.collection('authSessions').doc(String(payload.sessionId)).get(),
      ]);
      if (!userSnapshot.exists || !sessionSnapshot.exists) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
      }
      const user = userSnapshot.data();
      const session = sessionSnapshot.data();
      if (user.status !== 'active' || session.revoked === true || session.userId !== String(payload.userId) || Number(session.expiresAt) <= Date.now()) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
      }
      const roles = (Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean))
        .map((role) => String(role).trim().toLowerCase());
      if (!roles.length) return res.status(403).json({ status: 'error', message: 'Access denied.' });
      const isPlatformAdminRecord = roles.includes('super_admin') && user.platformAdmin === true && !user.tenantId && !user.schoolId;
      if (roles.includes('super_admin') && !isPlatformAdminRecord) {
        return res.status(403).json({ status: 'error', message: 'Platform administrator record is invalid.' });
      }
      if (user.firebaseUid) {
        const firebaseUser = await firebaseAdmin.getUser(user.firebaseUid);
        const claims = firebaseUser.customClaims || {};
        const claimRoles = Array.isArray(claims.roles) ? claims.roles : [claims.role].filter(Boolean);
        const rolesChanged = claimRoles.length > 0 &&
          JSON.stringify(claimRoles.slice().sort()) !== JSON.stringify(roles.slice().sort());
        const hasUnexpectedPlatformAdminClaims = !roles.includes('super_admin') &&
          (claims.role === 'super_admin' || claims.platformAdmin === true || claimRoles.includes('super_admin'));
        const hasInvalidPlatformAdminClaims = roles.includes('super_admin') &&
          (claims.role !== 'super_admin' || claims.platformAdmin !== true || !claimRoles.includes('super_admin'));
        if (firebaseUser.disabled || rolesChanged || hasUnexpectedPlatformAdminClaims || hasInvalidPlatformAdminClaims) {
          if (isPlatformAdminRecord && typeof firebaseAdmin.setCustomUserClaims === 'function') {
            await firebaseAdmin.setCustomUserClaims(user.firebaseUid, {
              tenantId: user.tenantId || user.schoolId || null,
              schoolId: user.schoolId || user.tenantId || null,
              role: 'super_admin',
              roles: ['super_admin'],
              platformAdmin: true,
            });
          } else {
            return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
          }
        }
      }
      req.user = {
        ...payload,
        tenantId: user.tenantId || user.schoolId || null,
        roles,
        platformAdmin: user.platformAdmin === true && roles.includes('super_admin'),
        passwordNeedsReset: user.passwordNeedsReset === true,
        status: user.status,
      };
      if (await enforceMaintenanceMode(req, res, req.user)) return;
      if (enforcePasswordChange(req, res, req.user)) return;
      return next();
    }

    if (prisma && !prisma.__stub && payload.userId && !fallbackLocalToken) {
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user || user.status !== 'active') {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
      }
      payload.passwordNeedsReset = user.passwordNeedsReset === true;
    }

    if (fallbackLocalToken) {
      payload.passwordNeedsReset = payload.passwordNeedsReset === true;
    }

    req.user = payload; // minimal payload: { userId, roles, tenantId, passwordNeedsReset }
    if (await enforceMaintenanceMode(req, res, req.user)) return;
    const fallbackUser = process.env.NODE_ENV !== 'production' && prisma?.__stub
      ? findFallbackUserByPayload(payload)
      : null;
    if (fallbackUser && enforceAccountStatus(req, res, fallbackUser)) return;
    if (payload.status && String(payload.status).toLowerCase() === 'suspended') {
      return res.status(403).json({
        status: 'error',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Please contact your school administrator.',
      });
    }
    if (enforcePasswordChange(req, res, req.user)) return;
    return next();
  } catch (err) {
    const mockPayload = process.env.NODE_ENV !== 'production' ? parseMockToken(token) : null;
    if (mockPayload) {
      const fallbackUser = findFallbackUser(mockPayload.schoolId, mockPayload.username);
      if (!fallbackUser) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
      }

      req.user = fallbackUser;
      if (await enforceMaintenanceMode(req, res, req.user)) return;
      if (enforceAccountStatus(req, res, req.user)) return;
      if (enforcePasswordChange(req, res, req.user)) return;
      return next();
    }

    if (firebaseData.isFirebaseDataConfigured()) {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
    }

    if (!firebaseAdmin.isFirebaseConfigured()) {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
    }

    try {
      const decodedToken = await firebaseAdmin.verifyIdToken(token);
      const firebaseUser = await resolveFirebaseUser(decodedToken);
      if (!firebaseUser) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
      }
      req.user = firebaseUser;
      if (await enforceMaintenanceMode(req, res, req.user)) return;
      if (enforceAccountStatus(req, res, req.user)) return;
      if (enforcePasswordChange(req, res, req.user)) return;
      return next();
    } catch (firebaseError) {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
    }
  }
}

module.exports = authMiddleware;
