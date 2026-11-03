// auth.controller.js
// Express route handlers for authentication endpoints. Delegates logic to auth.service.

const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const config = require('../../config/auth.config');
const { getAppUrl } = require('../../config/app-url.config');
const firebaseAdmin = require('../../firebase.admin');
const firebaseData = require('../../firebase.data');
const firebaseCore = require('../../firebase.core');
const router = express.Router();
const authService = require('./auth.service');
const { sendEmail, resetTemplate, verificationTemplate } = require('./utils/email');
const schoolService = require('../school/school.service');
const { DEFAULT_TRIAL_LABEL, createTrialEndDate } = require('../school/trial-period');
const { validateRegistrationPayload } = require('./registration.service');
const authMiddleware = require('./middleware/auth.middleware');
const {
  getLoginAttemptKey,
  isLoginRateLimited,
  recordLoginFailure,
  clearLoginFailures,
} = require('./utils/login-rate-limiter');
const { recordAuditEvent } = require('../audit/audit.service');

function registrationErrorDetails(error, phase) {
  const errorName = String(error?.name || 'Error').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'Error';
  const rawCode = error?.code;
  const errorCode = rawCode === undefined || rawCode === null
    ? ''
    : String(rawCode).replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 80);
  const operation = String(error?.registrationOperation || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80);
  return { phase, ...(operation ? { operation } : {}), errorName, ...(errorCode ? { errorCode } : {}) };
}

function canManageUserSession(req, userId) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return req.user?.userId === userId || roles.some((role) => String(role).toLowerCase() === 'super_admin');
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api/v1/auth',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

function setRefreshCookie(res, refreshToken) {
  if (refreshToken) res.cookie('globyedu_refresh_token', refreshToken, { ...sessionCookieOptions(), maxAge: 30 * 24 * 60 * 60 * 1000 });
}

function getRefreshCookie(req) {
  const header = String(req.headers.cookie || '');
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith('globyedu_refresh_token='));
  return match ? decodeURIComponent(match.slice('globyedu_refresh_token='.length)) : null;
}

function loadSchoolData() {
  const filePath = path.join(__dirname, '../../data/schools.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  return json.schools || [];
}

function saveSchoolData(schools) {
  const filePath = path.join(__dirname, '../../data/schools.json');
  fs.writeFileSync(filePath, JSON.stringify({ schools }, null, 2), 'utf-8');
}

// POST /api/v1/auth/register
// Accepts a structured registration payload (multi-step wizard). Creates tenant, school head,
// default roles and settings. Firebase accounts must verify email before login.
router.post('/register', async (req, res) => {
  const payload = req.body || {};
  const schoolHead = payload.head || {};
  const agreements = payload.agreements || {};
  let phase = 'registration.preflight';
  let firebaseMode = false;
  let createdSchoolId = null;
  let createdAuthUser = null;
  try {
    firebaseMode = firebaseData.isFirebaseDataConfigured();
    let appUrl = '';
    let existingSchools;
    if (firebaseMode) {
      phase = 'firebase.configuration';
      if (!firebaseAdmin.isFirebaseConfigured()) throw new Error('Firebase Authentication is not configured.');
      appUrl = getAppUrl();
      phase = 'firebase.tenant.lookup';
      existingSchools = await firebaseCore.listTenants();
    } else {
      existingSchools = loadSchoolData();
    }

    const validation = validateRegistrationPayload({ ...payload, head: { ...schoolHead, confirmPassword: payload.head?.confirmPassword }, agreements }, existingSchools);
    if (!validation.ok) {
      return res.status(400).json({ status: 'error', message: validation.message || 'Please review the registration details and try again.' });
    }

    const normalizedHeadEmail = String(schoolHead.email || payload.email || '').trim().toLowerCase();
    if (firebaseMode) {
      phase = 'firebase.account.lookup';
      const existingUserRecord = await firebaseCore.findUserByEmail(normalizedHeadEmail);
      if (existingUserRecord) {
        const error = new Error('A school registration already exists for this authority email.');
        error.code = 'SCHOOL_REGISTRATION_EXISTS';
        throw error;
      }
      try {
        const existingAuthUser = await firebaseAdmin.getUserByEmail(normalizedHeadEmail);
        if (existingAuthUser) {
          const error = new Error('A school registration already exists for this authority email.');
          error.code = 'SCHOOL_REGISTRATION_EXISTS';
          throw error;
        }
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    }

    const trialStartedAt = new Date();
    const trialEndsAt = createTrialEndDate(trialStartedAt);
    const schoolId = payload.schoolId || null;
    const schoolPayload = {
      name: payload.schoolName,
      ...(schoolId ? { schoolId, tenantId: schoolId } : {}),
      country: payload.country || payload.schoolCountry || null,
      region: payload.state || payload.region || null,
      city: payload.city || payload.town || null,
      address: payload.address || null,
      phone: payload.phone || null,
      email: payload.email || null,
      timezone: payload.timezone || null,
      logo: payload.logo || null,
      branding: {
        logo: payload.logo || null,
        schoolType: payload.schoolType || null,
      },
      settings: {
        currency: payload.currency || null,
        language: payload.language || null,
        academicCalendar: payload.academicCalendar || null,
      },
      headFullName: schoolHead.fullName,
      headEmail: String(schoolHead.email || payload.email || '').trim().toLowerCase(),
      headPassword: schoolHead.password,
      subscriptionPlan: DEFAULT_TRIAL_LABEL,
      subscriptionStatus: 'trial',
      trialStatus: DEFAULT_TRIAL_LABEL,
      trialStartedAt,
      trialEndsAt,
      schoolStatus: 'active',
    };

    if (firebaseMode) {
      phase = 'firebase.auth.create';
      try {
        createdAuthUser = await firebaseAdmin.createUser({
          email: schoolPayload.headEmail,
          password: schoolHead.password,
          displayName: schoolHead.fullName,
        });
      } catch (error) {
        if (error?.code === 'auth/email-already-exists') {
          error.code = 'SCHOOL_REGISTRATION_EXISTS';
          error.registrationOperation = 'firebase.auth.create';
        }
        throw error;
      }
      if (!createdAuthUser?.uid) throw new Error('Firebase Auth did not return the created account identifier.');
    }

    phase = 'school.create';
    const created = await schoolService.createSchool(schoolPayload);
    const tenantId = created.schoolId || created.id || (created.school && created.school.schoolId) || schoolId;
    if (!tenantId) throw new Error('School creation did not return a school ID.');
    createdSchoolId = tenantId;

    if (firebaseMode) {
      phase = 'firebase.verification.link';
      const verificationLink = await firebaseAdmin.generateEmailVerificationLink(schoolPayload.headEmail, {
        url: `${appUrl}/#/login`,
      });
      phase = 'firebase.verification.email';
      const delivery = await sendEmail(schoolPayload.headEmail, 'Verify your email', verificationTemplate(verificationLink, appUrl));
      if (delivery?.ok !== true) {
        const error = new Error('Verification email delivery failed.');
        error.code = delivery?.reason || 'EMAIL_DELIVERY_FAILED';
        error.registrationOperation = 'verification-email.send';
        throw error;
      }

      return res.status(202).json({
        status: 'pending_verification',
        requiresEmailVerification: true,
        schoolId: tenantId,
        tenantId,
        trialEndsAt: (created.trialEndsAt || trialEndsAt).toISOString ? (created.trialEndsAt || trialEndsAt).toISOString() : new Date(created.trialEndsAt || trialEndsAt).toISOString(),
        trialStatus: DEFAULT_TRIAL_LABEL,
        accountStatus: 'trial',
        schoolName: payload.schoolName,
        verificationEmail: schoolPayload.headEmail,
      });
    }

    phase = 'session.login';
    const headAccount = created.headAccount || { username: schoolPayload.headEmail, password: schoolHead.password };
    const loginResult = await authService.login(tenantId, headAccount.username, headAccount.password);
    if (!loginResult?.accessToken) throw new Error('School Authority session was not created.');

    phase = 'response.build';
    const response = {
      status: 'ok',
      schoolId: tenantId,
      tenantId,
      trialEndsAt: (created.trialEndsAt || trialEndsAt).toISOString ? (created.trialEndsAt || trialEndsAt).toISOString() : new Date(created.trialEndsAt || trialEndsAt).toISOString(),
      trialStatus: DEFAULT_TRIAL_LABEL,
      accountStatus: 'trial',
      schoolName: payload.schoolName,
      headAccount: { email: headAccount.username },
    };

    setRefreshCookie(res, loginResult.refreshToken);
    response.accessToken = loginResult.accessToken;
    response.user = { id: loginResult.user.id, email: loginResult.user.email, role: loginResult.user.roles?.[0] || 'school_authority' };

    return res.json(response);
  } catch (err) {
    let rollbackFailed = false;
    if (firebaseMode && createdAuthUser?.uid) {
      if (createdSchoolId) {
        try {
          const removed = await firebaseCore.deletePendingTenantRegistration(createdSchoolId, schoolHead.email || payload.email);
          if (!removed) rollbackFailed = true;
        } catch {
          rollbackFailed = true;
        }
      }
      try {
        await firebaseAdmin.deleteUser(createdAuthUser.uid);
      } catch {
        rollbackFailed = true;
      }
    }

    if (err?.code === 'SCHOOL_REGISTRATION_EXISTS') {
      if (rollbackFailed) {
        return res.status(503).json({
          status: 'error',
          code: 'REGISTRATION_CLEANUP_REQUIRED',
          message: 'Registration could not be completed or fully rolled back. Contact support before retrying.',
        });
      }
      return res.status(409).json({ status: 'error', message: 'A school registration for this authority email already exists. Please contact support before retrying.' });
    }

    console.error('[auth.register] School signup failed', registrationErrorDetails(err, phase));
    if (rollbackFailed) {
      return res.status(503).json({
        status: 'error',
        code: 'REGISTRATION_CLEANUP_REQUIRED',
        message: 'Registration could not be completed or fully rolled back. Contact support before retrying.',
        ...(createdSchoolId ? { schoolId: createdSchoolId, tenantId: createdSchoolId } : {}),
      });
    }
    if (firebaseMode && phase.startsWith('firebase.')) {
      const providerFailure = err?.code === 'EMAIL_PROVIDER_NOT_CONFIGURED'
        || err?.code === 'EMAIL_TRANSPORT_UNAVAILABLE'
        || err?.code === 'RESEND_API_ERROR'
        || err?.code === 'RESEND_REQUEST_FAILED'
        || err?.code === 'BREVO_API_ERROR'
        || err?.code === 'BREVO_REQUEST_FAILED'
        ? err.code
        : null;
      return res.status(503).json({
        status: 'error',
        code: providerFailure || 'REGISTRATION_VERIFICATION_SETUP_FAILED',
        message: providerFailure
          ? 'Registration was rolled back because the configured email provider could not deliver the verification message. Configure a verified sender and retry later.'
          : 'Registration was rolled back because email verification setup could not be completed. Please retry later.',
        ...(providerFailure ? { retryable: true } : {}),
      });
    }
    return res.status(500).json({ status: 'error', message: 'We could not create your school account right now. Please try again.' });
  }
});

// Sessions: list and revoke active refresh tokens for a user (Prisma only).
// GET /api/v1/auth/sessions/:userId
router.get('/sessions/:userId', authMiddleware, async (req, res) => {
  const { userId } = req.params || {};
  if (!canManageUserSession(req, userId)) return res.status(403).json({ status: 'error', message: 'Access denied.' });
  const prisma = require('../../config/prisma.client');
  if (!prisma || prisma.__stub) return res.status(501).json({ status: 'error', message: 'Session management not available in fallback mode.' });
  try {
    const sessions = await prisma.refreshToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const sanitized = sessions.map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, revoked: s.revoked }));
    return res.json({ status: 'ok', sessions: sanitized });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Unable to fetch sessions.' });
  }
});

// POST /api/v1/auth/sessions/revoke
router.post('/sessions/revoke', authMiddleware, async (req, res) => {
  const { userId, sessionId } = req.body || {};
  const prisma = require('../../config/prisma.client');
  if (!prisma || prisma.__stub) return res.status(501).json({ status: 'error', message: 'Session management not available in fallback mode.' });
  if (!userId || !sessionId) return res.status(400).json({ status: 'error', message: 'userId and sessionId are required.' });
  if (!canManageUserSession(req, userId)) return res.status(403).json({ status: 'error', message: 'Access denied.' });
  try {
    await prisma.refreshToken.updateMany({ where: { id: sessionId, userId }, data: { revoked: true } });
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Unable to revoke session.' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  const { schoolId, username, password } = req.body || {};
  const loginAttemptKey = getLoginAttemptKey({ schoolId, username, platformAdminMode: false });
  if (isLoginRateLimited(loginAttemptKey)) {
    await recordAuditEvent({ req, tenantId: schoolId || null, action: 'auth.login_rate_limited', resourceType: 'user', success: false, metadata: { loginType: 'prisma' } });
    return res.status(429).json({ status: 'error', message: 'Too many failed sign-in attempts. Please try again later.' });
  }

  try {
    if (!schoolId || !username || !password) {
      recordLoginFailure(loginAttemptKey);
      await recordAuditEvent({ req, tenantId: schoolId || null, action: 'auth.login_failed', resourceType: 'user', success: false, metadata: { loginType: 'prisma', reason: 'missing_credentials' } });
      return res.status(400).json({ status: 'error', message: 'Missing credentials' });
    }

    const result = await authService.login(schoolId, username, password);
    clearLoginFailures(loginAttemptKey);
    setRefreshCookie(res, result.refreshToken);
    await recordAuditEvent({ req, actorId: result.user.id, actorRole: result.user.roles?.[0], tenantId: result.user.tenantId || schoolId, action: 'auth.login_succeeded', resourceType: 'user', resourceId: result.user.id, metadata: { loginType: 'prisma' } });
    return res.json({ status: 'ok', accessToken: result.accessToken, user: { id: result.user.id, email: result.user.email, roles: result.user.roles } });
  } catch (err) {
    recordLoginFailure(loginAttemptKey);
    await recordAuditEvent({ req, tenantId: schoolId || null, action: 'auth.login_failed', resourceType: 'user', success: false, metadata: { loginType: 'prisma' } });
    return res.status(401).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/auth/firebase-login
router.post('/firebase-login', async (req, res) => {
  try {
    const { idToken, schoolId, platformAdmin, identifier, loginType } = req.body || {};
    if (!idToken || !schoolId) return res.status(400).json({ status: 'error', message: 'Missing Firebase token or school ID' });

    const result = await authService.loginWithFirebaseIdToken(idToken, schoolId, { platformAdminMode: platformAdmin === true, identifier, loginType });
    setRefreshCookie(res, result.refreshToken);
    return res.json({
      status: 'ok',
      accessToken: result.accessToken,
      tenantId: result.tenantId,
      schoolId: result.schoolId,
      user: { id: result.user.id, email: result.user.email, displayName: result.user.displayName, roles: result.user.roles },
    });
  } catch (err) {
    const isTeacherLogin = String(req.body?.loginType || '').trim().toLowerCase() === 'teacher';
    return res.status(401).json({
      status: 'error',
      message: isTeacherLogin ? 'Unable to sign in. Please check your details.' : err.message,
    });
  }
});

router.post('/firebase-link', authMiddleware, async (req, res) => {
  try {
    const { idToken } = req.body || {};
    const userId = req.user?.userId;
    const tenantId = req.user?.tenantId;
    if (!idToken || !userId || !tenantId) return res.status(400).json({ status: 'error', message: 'Missing Firebase token or authenticated user.' });
    const user = await authService.linkFirebaseIdentity(idToken, userId, tenantId);
    return res.json({ status: 'ok', linked: true, user: { id: user.id, googleEmail: user.googleEmail } });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = getRefreshCookie(req) || req.body?.refreshToken;
    if (!refreshToken) return res.status(400).json({ status: 'error', message: 'Missing refresh token' });
    const tokens = await authService.refresh(refreshToken);
    setRefreshCookie(res, tokens.refreshToken);
    return res.json({ status: 'ok', accessToken: tokens.accessToken });
  } catch (err) {
    return res.status(401).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const refreshToken = getRefreshCookie(req) || req.body?.refreshToken;
    if (!userId || !refreshToken) return res.status(400).json({ status: 'error', message: 'Authenticated session is required' });
    await authService.logout(userId, refreshToken);
    res.clearCookie('globyedu_refresh_token', sessionCookieOptions());
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, loginType = 'school' } = req.body || {};
    const appUrl = getAppUrl();
    const result = await authService.forgotPassword(email, {
      loginType,
      deliverResetToken: async (token) => {
        const delivery = await sendEmail(email, 'Reset your GlobyEdu password', resetTemplate(token, appUrl));
        if (!delivery || delivery.ok !== true) {
          throw new Error('Password reset email could not be delivered.');
        }
      },
    });
    if (!firebaseData.isFirebaseDataConfigured() && result) {
      const delivery = await sendEmail(email, 'Reset your GlobyEdu password', resetTemplate(result, appUrl));
      if (!delivery || delivery.ok !== true) {
        throw new Error('Password reset email could not be delivered.');
      }
    }
    return res.json({ status: 'ok' });
  } catch (err) {
    const errorCode = String(err?.code || '').replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 80);
    await recordAuditEvent({
      req,
      action: 'auth.password_reset_request_failed',
      resourceType: 'user',
      success: false,
      metadata: { errorCode: errorCode || 'REQUEST_FAILED' },
    });
    return res.json({ status: 'ok' });
  }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const result = await authService.resetPassword(token, password);
    await recordAuditEvent({ req, action: 'auth.password_reset', resourceType: 'user', metadata: { initiatedBy: 'recovery_token' } });
    return res.json({ status: 'ok', ...(result && typeof result === 'object' ? result : {}) });
  } catch (err) {
    await recordAuditEvent({ req, action: 'auth.password_reset_failed', resourceType: 'user', success: false });
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// POST /api/v1/auth/change-password (requires auth) - left as a protected route to be wired
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { userId: requestedUserId, oldPassword, newPassword } = req.body || {};
    const userId = req.user?.userId;
    if (!userId || (requestedUserId && requestedUserId !== userId) || !canManageUserSession(req, userId)) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }
    const session = await authService.changePassword(userId, oldPassword, newPassword);
    setRefreshCookie(res, session.refreshToken);
    await recordAuditEvent({ req, actorId: userId, actorRole: req.user?.roles?.[0], tenantId: req.user?.tenantId, action: 'auth.password_changed', resourceType: 'user', resourceId: userId });
    return res.json({ status: 'ok', accessToken: session.accessToken, passwordNeedsReset: false });
  } catch (err) {
    await recordAuditEvent({ req, actorId: req.user?.userId, actorRole: req.user?.roles?.[0], tenantId: req.user?.tenantId, action: 'auth.password_change_failed', resourceType: 'user', resourceId: req.user?.userId, success: false });
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
