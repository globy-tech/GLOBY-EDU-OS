// auth.js
// Authentication router for GlobyEdu OS backend.
// This module provides basic multi-tenant login support with a mock token response.

const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('../config/auth.config');
const { getAppUrl } = require('../config/app-url.config');
const { signAccessToken } = require('../modules/auth/utils/token');
const { revokeAccessToken } = require('../modules/auth/utils/access-token-revocation');
const authService = require('../modules/auth/auth.service');
const firebaseData = require('../firebase.data');
const firebaseCore = require('../firebase.core');
const schoolService = require('../modules/school/school.service');
const { DEFAULT_TRIAL_LABEL, createTrialEndDate } = require('../modules/school/trial-period');
const { sendEmail, resetTemplate, welcomeTemplate } = require('../modules/auth/utils/email');
const {
  loadSchoolData,
  saveSchoolData,
  createSchoolId,
  ensureDemoSchool,
  findPlatformAdminByEmail,
} = require('../modules/school/fallback.school');
const { generateSchoolId, validateRegistrationPayload } = require('../modules/auth/registration.service');
const authMiddleware = require('../modules/auth/middleware/auth.middleware');
const {
  getLoginAttemptKey,
  isLoginRateLimited,
  recordLoginFailure,
  clearLoginFailures,
} = require('../modules/auth/utils/login-rate-limiter');
const { recordAuditEvent } = require('../modules/audit/audit.service');
const router = express.Router();

function setRefreshCookie(res, refreshToken) {
  if (!refreshToken) return;
  const production = process.env.NODE_ENV === 'production' || Boolean(String(process.env.RENDER_SERVICE_ID || '').trim());
  res.cookie('globyedu_refresh_token', refreshToken, {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'strict' : 'lax',
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
}

const DEV_TENANT_ID = 'globy-school';
const DEV_TENANT_NAME = 'Globy School';
const DEV_ADMIN_PASSWORD = process.env.DEV_SUPER_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'Benjamin@123');
const DEVELOPMENT_MODE = process.env.NODE_ENV !== 'production';
const DEV_SUPER_ADMINS = [
  { username: 'ataetaben@gmail.com', fullName: 'Benjamin' },
  { username: 'ataetabenjamin@gmail.com', fullName: 'Benjamin' },
  { username: 'hellogloby@gmail.com', fullName: 'Benjamin' },
  { username: 'benjaminataeta@gmail.com', fullName: 'Benjamin' },
];
const RESET_TOKEN_FILE = process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE
  ? path.resolve(process.env.GLOBY_PASSWORD_RESET_TOKENS_FILE)
  : path.join(__dirname, '../data/password-reset-tokens.json');
function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(String(password || ''));
}

async function auditFallbackLogin(req, result, platformAdminMode) {
  const body = result.body || {};
  const response = body.response || {};
  const success = result.statusCode === 200;
  const action = result.statusCode === 429
    ? 'auth.login_rate_limited'
    : success
      ? 'auth.login_succeeded'
      : 'auth.login_failed';
  await recordAuditEvent({
    req,
    actorId: success ? `${response.schoolId || req.body?.schoolId || DEV_TENANT_ID}:${response.username || req.body?.username || ''}` : null,
    actorRole: success ? response.role : null,
    tenantId: response.schoolId || req.body?.schoolId || (platformAdminMode ? null : null),
    action,
    resourceType: 'user',
    success,
    metadata: { loginType: platformAdminMode ? 'platform' : 'fallback' },
  });
}

function findFallbackUserFromRequest(req) {
  const userId = req.user?.userId || '';
  const separator = userId.indexOf(':');
  if (separator === -1) return null;
  const schoolId = userId.slice(0, separator);
  const username = userId.slice(separator + 1);
  const schools = loadSchoolData();
  const school = schools.find((entry) => entry.schoolId === schoolId);
  const user = (school?.users || []).find((entry) => String(entry.username || '').toLowerCase() === username.toLowerCase());
  return user && school ? { school, user } : null;
}

function loadResetTokens() {
  if (!fs.existsSync(RESET_TOKEN_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(RESET_TOKEN_FILE, 'utf-8');
    const json = JSON.parse(raw);
    return json.tokens || [];
  } catch (err) {
    return [];
  }
}

function saveResetTokens(tokens) {
  fs.writeFileSync(RESET_TOKEN_FILE, JSON.stringify({ tokens }, null, 2), 'utf-8');
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function storePasswordResetToken(email) {
  const rawToken = generateResetToken();
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + config.tokens.emailTokenMinutes * 60 * 1000).toISOString();
  const tokens = loadResetTokens();
  tokens.push({ tokenHash, email, used: false, expiresAt });
  saveResetTokens(tokens);
  return rawToken;
}

function validateResetToken(rawToken) {
  const tokenHash = hashResetToken(rawToken);
  const tokens = loadResetTokens();
  const record = tokens.find((entry) => entry.tokenHash === tokenHash && !entry.used);
  if (!record) return null;
  if (new Date(record.expiresAt) < new Date()) return null;
  return record;
}

function markResetTokenUsed(rawToken) {
  const tokenHash = hashResetToken(rawToken);
  const tokens = loadResetTokens();
  const updated = tokens.map((entry) => ({
    ...entry,
    used: entry.tokenHash === tokenHash ? true : entry.used,
  }));
  saveResetTokens(updated);
}

async function ensureDevelopmentAccounts() {
  if (!DEVELOPMENT_MODE || String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true') {
    return;
  }

  if (!DEV_ADMIN_PASSWORD) {
    console.warn('DEV_SUPER_ADMIN_PASSWORD is not configured. Development Super Admin accounts will not be seeded.');
    return;
  }

  try {
    ensureDemoSchool();
  } catch (error) {
    console.error('Failed to seed development Super Admin accounts:', error);
  }
}


ensureDevelopmentAccounts().catch((error) => {
  console.error('Failed to seed development Super Admin accounts:', error);
});

async function verifyPassword(storedUser, candidatePassword) {
  if (!storedUser || !candidatePassword) return false;

  const candidates = [];
  if (storedUser.studentPasswordHash) candidates.push(storedUser.studentPasswordHash);
  if (storedUser.passwordHash) candidates.push(storedUser.passwordHash);

  for (const hash of candidates) {
    try {
      const matched = await bcrypt.compare(candidatePassword, hash);
      if (matched) return true;
    } catch (error) {
      // Ignore invalid hash entries and continue checking any remaining candidates.
    }
  }

  return false;
}

// Compatibility shim: delegate to new auth module when a real Prisma client exists.
// When the Prisma client is a stub, use the original simple schools endpoint instead.
const prismaClient = require('../config/prisma.client');
const useFallbackAuth = prismaClient && prismaClient.__stub;

if (!useFallbackAuth) {
  try {
    // Mount the Prisma-backed auth router if available.
    // Keep legacy fallback routes active for platform admin and school login compatibility.
    const newAuth = require('../modules/auth/auth.routes');
    router.use('/', newAuth);
  } catch (err) {
    // Fallback to original behaviour if the new auth module cannot be loaded.
  }
}

// Fallback to original behaviour when Prisma is not configured or to preserve
// compatibility with the existing marketing SPA routes.

// Endpoint: GET /api/v1/auth/schools
// Returns the authoritative school list for the frontend dropdown.
router.get('/schools', async (req, res) => {
  try {
    const schools = await schoolService.listSchools('');
    const response = schools
      .filter((school) => school && typeof school === 'object')
      .map((school) => ({
        schoolId: school.schoolId,
        name: school.name,
      }))
      .filter((school) => school.schoolId || school.name);

    return res.json({
      status: 'ok',
      schools: response,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Unable to load schools.' });
  }
});

if (useFallbackAuth) {
  router.post('/logout', authMiddleware, (req, res) => {
    const token = String(req.headers.authorization || '').slice('Bearer '.length);
    revokeAccessToken(token, req.user?.exp);
    res.clearCookie('globyedu_refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || Boolean(String(process.env.RENDER_SERVICE_ID || '').trim()),
      sameSite: process.env.NODE_ENV === 'production' || Boolean(String(process.env.RENDER_SERVICE_ID || '').trim()) ? 'strict' : 'lax',
      path: '/api/v1/auth',
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    });
    return res.json({ status: 'ok' });
  });
}

  // Endpoint: POST /api/v1/auth/register
  // Create a new school account for marketing signup.
  router.post('/register', async (req, res) => {
    const payload = req.body || {};
    const schoolName = payload.schoolName || '';
    const head = payload.head || {};
    const agreements = payload.agreements || {};
    const schools = loadSchoolData();
    const validation = validateRegistrationPayload({ ...payload, agreements, head: { ...head, confirmPassword: head.confirmPassword } }, schools);

    if (!validation.ok) {
      return res.status(400).json({
        status: 'error',
        message: validation.message || 'Please review the registration details and try again.',
      });
    }

    const schoolId = payload.schoolId || generateSchoolId(schoolName, schools);
    const headEmail = String(head.email || payload.email || '').trim().toLowerCase();
    const headPassword = head.password || payload.password || '';
    const passwordHash = await bcrypt.hash(headPassword, config.bcrypt.saltRounds);
    const trialStartedAt = new Date().toISOString();
    const trialEndsAt = createTrialEndDate(trialStartedAt).toISOString();
    const newSchool = {
      schoolId,
      tenantId: schoolId,
      name: schoolName,
      description: 'School created by GlobyEdu registration flow.',
      logo: payload.logo || null,
      website: payload.website || null,
      country: payload.country || null,
      region: payload.state || null,
      city: payload.city || null,
      address: payload.address || null,
      phone: payload.phone || null,
      email: payload.email || null,
      subscriptionPlan: DEFAULT_TRIAL_LABEL,
      subscriptionStatus: 'trial',
      trialStatus: DEFAULT_TRIAL_LABEL,
      schoolStatus: 'active',
      trialStartedAt,
      trialEndsAt,
      createdAt: trialStartedAt,
      settings: {
        theme: 'default',
        notifications: { emailEnabled: true, smsEnabled: false },
        featureFlags: { messaging: true, analytics: true },
      },
      users: [
        {
          username: headEmail,
          passwordHash,
          role: 'school_authority',
          platformAdmin: false,
          grade: 'N/A',
          fullName: head.fullName || schoolName,
          status: 'active',
          emailVerified: true,
          permissions: ['school.manage', 'classes.manage', 'users.manage'],
        },
      ],
    };

    schools.push(newSchool);
    saveSchoolData(schools);

    const loginResult = await executeLogin({ schoolId, username: headEmail, password: headPassword, platformAdminMode: false });
    const response = {
      status: 'ok',
      schoolId,
      tenantId: schoolId,
      trialEndsAt,
      trialStatus: DEFAULT_TRIAL_LABEL,
      accountStatus: 'trial',
      schoolName,
      headAccount: { email: headEmail },
    };

    if (loginResult.statusCode === 200) {
      response.accessToken = loginResult.body.accessToken;
      response.user = { email: headEmail, role: 'school_authority' };
    }

    return res.json(response);
  });

  async function executeLogin({ schoolId, username, password, platformAdminMode, schoolName, studentName, className, teacherName, loginType }) {
    const genericAuthMessage = 'Unable to sign in. Please check your details.';
    const suspendedAccountMessage = 'Your account has been suspended. Please contact your school administrator.';
    const loginAttemptKey = getLoginAttemptKey({ schoolId, username, platformAdminMode });

    if (isLoginRateLimited(loginAttemptKey)) {
      return { statusCode: 429, body: { status: 'error', message: 'Too many failed sign-in attempts. Please try again later.' } };
    }

    if (!username || !password) {
      recordLoginFailure(loginAttemptKey);
      return { statusCode: 400, body: { status: 'error', message: genericAuthMessage } };
    }

    const normalizedLoginType = String(loginType || '').toLowerCase();

    const schools = loadSchoolData();
    let user;
    let school;

    if (platformAdminMode) {
      const found = findPlatformAdminByEmail(username, schools);
      if (!found) {
        recordLoginFailure(loginAttemptKey);
        return { statusCode: 401, body: { status: 'error', message: genericAuthMessage } };
      }
      user = found.user;
      school = found.school;
    } else {
      const normalizedUsername = String(username || '').toLowerCase();
      const normalizedSchoolId = String(schoolId || '').trim().toLowerCase();
      const normalizedSchoolName = String(schoolName || '').trim().toLowerCase();
      const studentStudentName = String(studentName || '').trim().toLowerCase();
      const studentClassName = String(className || '').trim().toLowerCase();

      school = schools.find((entry) => {
        const matchesId = entry.schoolId && normalizedSchoolId && String(entry.schoolId).trim().toLowerCase() === normalizedSchoolId;
        const matchesName = entry.name && normalizedSchoolName && String(entry.name).trim().toLowerCase() === normalizedSchoolName;
        return matchesId || matchesName || (normalizedSchoolId === 'globy-school' && entry.name === 'Globy School');
      });

      if (!schoolId && !schoolName) {
        recordLoginFailure(loginAttemptKey);
        return { statusCode: 400, body: { status: 'error', message: genericAuthMessage } };
      }

      if (!school) {
        recordLoginFailure(loginAttemptKey);
        return { statusCode: 401, body: { status: 'error', message: genericAuthMessage } };
      }
      const resolvedSchool = schoolService.resolveSchoolLifecycleStatus(school);
      Object.assign(school, resolvedSchool);
      if (school.schoolStatus !== 'active') {
        return {
          statusCode: 403,
          body: {
            status: 'error',
            code: 'ACCOUNT_SUSPENDED',
            title: 'Account Suspended',
            message: suspendedAccountMessage,
            supportEmail: '[your support email]',
            supportPhone: '[your phone/WhatsApp number]',
          },
        };
      }
      if (!['active', 'trial'].includes((school.subscriptionStatus || 'inactive').toLowerCase())) {
        return {
          statusCode: 403,
          body: {
            status: 'error',
            code: 'ACCOUNT_SUSPENDED',
            title: 'Account Suspended',
            message: suspendedAccountMessage,
            supportEmail: '[your support email]',
            supportPhone: '[your phone/WhatsApp number]',
          },
        };
      }
      const schoolHeadExists = (school.users || []).some((entry) => ['school_head', 'school_authority'].includes(entry.role));
      if (!schoolHeadExists) {
        return { statusCode: 500, body: { status: 'error', message: genericAuthMessage } };
      }

      if (normalizedLoginType === 'teacher') {
        user = (school.users || []).find((entry) => {
          const candidateUsernames = [String(entry.teacherId || ''), String(entry.username || ''), String(entry.email || '')];
          return candidateUsernames.some((value) => value.toLowerCase() === normalizedUsername) || (String(entry.fullName || '').toLowerCase() === normalizedUsername);
        });
      } else if (normalizedLoginType === 'student') {
        user = (school.users || []).find((entry) => {
          const candidateUsernames = [String(entry.studentId || ''), String(entry.username || ''), String(entry.email || '')];
          return candidateUsernames.some((value) => value.toLowerCase() === normalizedUsername);
        });
      } else {
        const schoolUserMatch = (school.users || []).find((entry) => {
          const candidateUsernames = [String(entry.username || ''), String(entry.email || '')];
          return candidateUsernames.some((value) => value.toLowerCase() === normalizedUsername);
        });
        user = schoolUserMatch;
      }

      if (user && user.role === 'student') {
        const profileMatch = (school.students || []).find((entry) => String(entry.studentId || '').toLowerCase() === String(user.studentId || user.username || '').toLowerCase());
        if (profileMatch) {
          const requestedStudentName = String(studentName || '').trim().toLowerCase();
          const requestedStudentClass = String(className || '').trim().toLowerCase();
          const actualStudentName = String(profileMatch.fullName || '').trim().toLowerCase();
          const actualStudentClass = String(profileMatch.className || '').trim().toLowerCase();
          if (requestedStudentName && requestedStudentName !== actualStudentName) {
            return { statusCode: 401, body: { status: 'error', message: genericAuthMessage } };
          }
          if (requestedStudentClass && requestedStudentClass !== actualStudentClass) {
            return { statusCode: 401, body: { status: 'error', message: genericAuthMessage } };
          }
        }
      }

      if (user && user.role === 'teacher') {
        const requestedTeacherName = String(teacherName || '').trim().toLowerCase();
        if (requestedTeacherName) {
          const actualTeacherName = String(user.fullName || '').trim().toLowerCase();
          if (requestedTeacherName !== actualTeacherName) {
            return { statusCode: 401, body: { status: 'error', message: genericAuthMessage } };
          }
        }
      }
    }

    const passwordMatches = user && (await verifyPassword(user, password));
    if (!user || !passwordMatches) {
      recordLoginFailure(loginAttemptKey);
      return { statusCode: 401, body: { status: 'error', message: genericAuthMessage } };
    }

    if (user.status !== 'active') {
      return { statusCode: 403, body: { status: 'error', code: 'ACCOUNT_SUSPENDED', message: suspendedAccountMessage } };
    }

    if (user.emailVerified !== true) {
      return { statusCode: 403, body: { status: 'error', message: genericAuthMessage } };
    }

    if (platformAdminMode && user.platformAdmin !== true) {
      recordLoginFailure(loginAttemptKey);
      return { statusCode: 403, body: { status: 'error', message: genericAuthMessage } };
    }

    clearLoginFailures(loginAttemptKey);

    const token = signAccessToken({
      userId: `${school?.schoolId || DEV_TENANT_ID}:${user.username || username}`,
      tenantId: platformAdminMode === true ? null : school?.schoolId || DEV_TENANT_ID,
      roles: [user.role],
      platformAdmin: platformAdminMode === true,
      passwordNeedsReset: user.passwordNeedsReset === true,
      jti: crypto.randomBytes(16).toString('hex'),
    });
    const response = {
      token,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      grade: user.grade || null,
      studentId: user.studentId || null,
      className: user.className || null,
      profilePhoto: user.profilePhoto || null,
      schoolId: school?.schoolId || null,
      schoolName: school?.name || null,
      platformAdmin: platformAdminMode,
      emailVerified: user.emailVerified === true,
      status: user.status || 'active',
      subscriptionPlan: school?.subscriptionPlan || 'Enterprise (Development)',
      subscriptionStatus: school?.subscriptionStatus || 'active',
      trialStatus: school?.trialStatus || 'Unlimited Development Access',
      schoolStatus: school?.schoolStatus || 'active',
      passwordNeedsReset: user.passwordNeedsReset === true,
    };

    return {
      statusCode: 200,
      body: {
        status: 'ok',
        token: response.token,
        accessToken: response.token,
        grade: response.grade,
        response,
        role: response.role,
        username: response.username,
        fullName: response.fullName,
        studentId: response.studentId,
        className: response.className,
        profilePhoto: response.profilePhoto,
        schoolId: response.schoolId,
        schoolName: response.schoolName,
        platformAdmin: response.platformAdmin,
        emailVerified: response.emailVerified,
        accountStatus: response.status,
        subscriptionPlan: response.subscriptionPlan,
        subscriptionStatus: response.subscriptionStatus,
        trialStatus: response.trialStatus,
        schoolStatus: response.schoolStatus,
        passwordNeedsReset: response.passwordNeedsReset,
      },
    };
  }

  router.post('/school-login', async (req, res) => {
    const { schoolId, username, password, schoolName, studentName, className, teacherName, loginType } = req.body || {};
    const firebaseMode = firebaseData.isFirebaseDataConfigured();
    const realDatabaseMode = firebaseMode || (prismaClient && !prismaClient.__stub);
    if (realDatabaseMode) {
      const loginAttemptKey = getLoginAttemptKey({ schoolId, username, platformAdminMode: false });
      if (isLoginRateLimited(loginAttemptKey)) {
        return res.status(429).json({ status: 'error', message: 'Too many failed sign-in attempts. Please try again later.' });
      }

      try {
        const session = await authService.login(schoolId, username, password, { loginType });
        setRefreshCookie(res, session.refreshToken);
        const tenant = firebaseMode
          ? await firebaseCore.getTenant(schoolId)
          : await schoolService.getSchoolBySchoolId(schoolId);
        clearLoginFailures(loginAttemptKey);
        await recordAuditEvent({
          req,
          actorId: session.user.id,
          actorRole: session.user.roles?.[0],
          tenantId: schoolId,
          action: 'auth.login_succeeded',
          resourceType: 'user',
          resourceId: session.user.id,
          metadata: { loginType: loginType || 'school', dataStore: firebaseMode ? 'firebase' : 'prisma' },
        });
        return res.json({
          status: 'ok',
          accessToken: session.accessToken,
          token: session.accessToken,
          role: session.user.roles?.[0] || session.user.role,
          username: session.user.username || username,
          fullName: session.user.fullName || username,
          schoolId,
          schoolName: tenant?.name || schoolName || schoolId,
          emailVerified: true,
          passwordNeedsReset: session.user.passwordNeedsReset === true,
        });
      } catch (error) {
        recordLoginFailure(loginAttemptKey);
        await recordAuditEvent({
          req,
          tenantId: schoolId || null,
          action: 'auth.login_failed',
          resourceType: 'user',
          success: false,
          metadata: { loginType: loginType || 'school', dataStore: firebaseMode ? 'firebase' : 'prisma' },
        });
        const statusCode = error.message === 'Tenant not found' ? 404 : 401;
        return res.status(statusCode).json({ status: 'error', message: error.message || 'Unable to sign in. Please check your details.' });
      }
    }

    const result = await executeLogin({
      schoolId,
      username,
      password,
      platformAdminMode: false,
      schoolName,
      studentName,
      className,
      teacherName,
      loginType,
    });
    await auditFallbackLogin(req, result, false);
    return res.status(result.statusCode).json(result.body);
  });

  router.post('/platform-login', async (req, res) => {
    const { username, password } = req.body || {};
    if (firebaseData.isFirebaseDataConfigured()) {
      const loginAttemptKey = getLoginAttemptKey({ username, platformAdminMode: true });
      if (isLoginRateLimited(loginAttemptKey)) {
        return res.status(429).json({ status: 'error', message: 'Too many failed sign-in attempts. Please try again later.' });
      }
      try {
        const session = await authService.loginPlatformAdmin(username, password);
        setRefreshCookie(res, session.refreshToken);
        clearLoginFailures(loginAttemptKey);
        await recordAuditEvent({
          req,
          actorId: session.user.id,
          actorRole: 'super_admin',
          action: 'auth.login_succeeded',
          resourceType: 'user',
          resourceId: session.user.id,
          metadata: { loginType: 'platform', dataStore: 'firebase' },
        });
        return res.json({
          status: 'ok',
          accessToken: session.accessToken,
          token: session.accessToken,
          role: 'super_admin',
          fullName: session.user.fullName || username,
          email: session.user.email || username,
          platformAdmin: true,
        });
      } catch (error) {
        recordLoginFailure(loginAttemptKey);
        await recordAuditEvent({
          req,
          action: 'auth.login_failed',
          resourceType: 'user',
          success: false,
          metadata: { loginType: 'platform', dataStore: 'firebase' },
        });
        return res.status(401).json({ status: 'error', message: 'Unable to sign in. Please check your details.' });
      }
    }
    const result = await executeLogin({ username, password, platformAdminMode: true });
    await auditFallbackLogin(req, result, true);
    return res.status(result.statusCode).json(result.body);
  });

  router.post('/login', async (req, res) => {
    const { loginType = 'school', schoolId, username, password } = req.body || {};
    if (loginType === 'platform_admin') {
      if (firebaseData.isFirebaseDataConfigured()) {
        const loginAttemptKey = getLoginAttemptKey({ username, platformAdminMode: true });
        if (isLoginRateLimited(loginAttemptKey)) {
          return res.status(429).json({ status: 'error', message: 'Too many failed sign-in attempts. Please try again later.' });
        }
        try {
          const session = await authService.loginPlatformAdmin(username, password);
          setRefreshCookie(res, session.refreshToken);
          clearLoginFailures(loginAttemptKey);
          await recordAuditEvent({
            req,
            actorId: session.user.id,
            actorRole: 'super_admin',
            action: 'auth.login_succeeded',
            resourceType: 'user',
            resourceId: session.user.id,
            metadata: { loginType: 'platform', dataStore: 'firebase' },
          });
          return res.json({ status: 'ok', accessToken: session.accessToken, role: 'super_admin', fullName: session.user.fullName || username, platformAdmin: true });
        } catch (error) {
          recordLoginFailure(loginAttemptKey);
          await recordAuditEvent({ req, action: 'auth.login_failed', resourceType: 'user', success: false, metadata: { loginType: 'platform', dataStore: 'firebase' } });
          return res.status(401).json({ status: 'error', message: 'Unable to sign in. Please check your details.' });
        }
      }
      const result = await executeLogin({ username, password, platformAdminMode: true });
      return res.status(result.statusCode).json(result.body);
    }
    const result = await executeLogin({ schoolId, username, password, platformAdminMode: false });
    await auditFallbackLogin(req, result, false);
    return res.status(result.statusCode).json(result.body);
  });

  router.post('/forgot-password', async (req, res) => {
    try {
      const { email, loginType = 'school' } = req.body || {};
      if (!email) {
        return res.status(400).json({ status: 'error', message: 'Email is required.' });
      }

      if (firebaseData.isFirebaseDataConfigured()) {
        try {
          await authService.forgotPassword(email, {
            loginType,
            deliverResetToken: async (token) => {
              const appUrl = getAppUrl();
              const delivery = await sendEmail(email, 'Reset your GlobyEdu password', resetTemplate(token, appUrl));
              if (delivery?.ok !== true) throw new Error('Password reset email delivery failed.');
            },
          });
        } catch {
          // Keep account existence and mail-provider failures indistinguishable to callers.
        }
        return res.json({ status: 'ok' });
      }

      const schools = loadSchoolData();
      let exists = false;
      let targetSchool = null;

      if (loginType === 'platform_admin') {
        const found = findPlatformAdminByEmail(email, schools);
        exists = Boolean(found);
        targetSchool = found?.school;
      } else {
        exists = schools.some((school) => (school.users || []).some((user) => user.username.toLowerCase() === email.toLowerCase()));
      }

      if (exists) {
        const token = storePasswordResetToken(email);
        const appUrl = getAppUrl();
        await sendEmail(email, 'Reset your GlobyEdu password', resetTemplate(token, appUrl));
      }

      return res.json({ status: 'ok' });
    } catch (error) {
      return res.status(500).json({ status: 'error', message: 'Unable to process reset request.' });
    }
  });

  router.post('/reset-password', async (req, res) => {
    try {
      const { token, password } = req.body || {};
      if (!token || !password) {
        return res.status(400).json({ status: 'error', message: 'Token and new password are required.' });
      }
      if (!isStrongPassword(password)) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters and include uppercase, lowercase, number, and symbol.' });
      }

      if (firebaseData.isFirebaseDataConfigured()) {
        await authService.resetPassword(token, password);
        await recordAuditEvent({ req, action: 'auth.password_reset', resourceType: 'user', metadata: { initiatedBy: 'recovery_token' } });
        return res.json({ status: 'ok' });
      }

      const record = validateResetToken(token);
      if (!record) {
        return res.status(400).json({ status: 'error', message: 'Invalid or expired reset token.' });
      }

      const schools = loadSchoolData();
      let passwordUpdated = false;
      for (const school of schools) {
        const user = (school.users || []).find((entry) => entry.username.toLowerCase() === record.email.toLowerCase());
        if (user) {
          user.passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
          passwordUpdated = true;
          break;
        }
      }

      if (!passwordUpdated) {
        return res.status(404).json({ status: 'error', message: 'User not found for token.' });
      }

      const resetUser = schools.flatMap((school) => school.users || []).find((entry) => String(entry.username || '').toLowerCase() === record.email.toLowerCase());
      if (resetUser) resetUser.passwordNeedsReset = false;

      markResetTokenUsed(token);
      saveSchoolData(schools);
      await recordAuditEvent({ req, tenantId: schools.find((school) => (school.users || []).some((entry) => String(entry.username || '').toLowerCase() === record.email.toLowerCase()))?.schoolId || null, action: 'auth.password_reset', resourceType: 'user', metadata: { initiatedBy: 'recovery_token' } });
      return res.json({ status: 'ok' });
    } catch (error) {
      const invalidToken = error.message === 'Invalid or expired token';
      return res.status(invalidToken ? 400 : 500).json({
        status: 'error',
        message: invalidToken ? 'Invalid or expired reset token.' : 'Unable to reset password.',
      });
    }
  });

  router.post('/change-password', authMiddleware, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body || {};
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ status: 'error', message: 'Current and new passwords are required.' });
      }
      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters and include uppercase, lowercase, number, and symbol.' });
      }

      if (firebaseData.isFirebaseDataConfigured()) {
        const session = await authService.changePassword(req.user.userId, oldPassword, newPassword);
        setRefreshCookie(res, session.refreshToken);
        await recordAuditEvent({ req, actorId: req.user.userId, actorRole: req.user.roles?.[0], tenantId: req.user.tenantId, action: 'auth.password_changed', resourceType: 'user', resourceId: req.user.userId });
        return res.json({ status: 'ok', accessToken: session.accessToken, token: session.accessToken, passwordNeedsReset: false });
      }

      const match = findFallbackUserFromRequest(req);
      if (!match) return res.status(404).json({ status: 'error', message: 'User not found.' });
      if (!(await verifyPassword(match.user, oldPassword))) {
        return res.status(400).json({ status: 'error', message: 'Invalid current password.' });
      }

      match.user.passwordHash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);
      delete match.user.studentPasswordHash;
      match.user.passwordNeedsReset = false;
      match.user.passwordChangedAt = new Date().toISOString();
      saveSchoolData(loadSchoolData().map((school) => school.schoolId === match.school.schoolId ? match.school : school));
      const accessToken = signAccessToken({
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        roles: req.user.roles,
        platformAdmin: req.user.platformAdmin === true,
        passwordNeedsReset: false,
        jti: crypto.randomBytes(16).toString('hex'),
      });
      await recordAuditEvent({ req, actorId: req.user.userId, actorRole: req.user.roles?.[0], tenantId: req.user.tenantId, action: 'auth.password_changed', resourceType: 'user', resourceId: req.user.userId });
      return res.json({ status: 'ok', accessToken, token: accessToken, passwordNeedsReset: false });
    } catch (error) {
      await recordAuditEvent({ req, actorId: req.user?.userId, actorRole: req.user?.roles?.[0], tenantId: req.user?.tenantId, action: 'auth.password_change_failed', resourceType: 'user', resourceId: req.user?.userId, success: false });
      if (error.message === 'Invalid current password') {
        return res.status(400).json({ status: 'error', message: 'Invalid current password.' });
      }
      return res.status(500).json({ status: 'error', message: 'Unable to change password.' });
    }
  });

module.exports = router;
