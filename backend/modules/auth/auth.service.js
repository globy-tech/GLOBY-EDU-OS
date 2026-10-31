// auth.service.js
// Business logic for authentication flows: login, refresh, logout, password reset.

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../config/prisma.client');
const config = require('../../config/auth.config');
const firebaseAdmin = require('../../firebase.admin');
const firebaseData = require('../../firebase.data');
const firebaseCore = require('../../firebase.core');
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('./utils/token');

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(String(password || ''));
}

async function findUserByIdentifier(tenantId, identifier) {
  const normalizedIdentifier = String(identifier || '').trim();
  if (!normalizedIdentifier) return null;

  if (firebaseData.isFirebaseDataConfigured()) {
    const snapshot = await firebaseData.getFirestore()
      .collection('users')
      .where('schoolId', '==', String(tenantId || '').trim())
      .get();

    const matches = snapshot.docs.filter((doc) => {
      const record = doc.data();
      const values = [record.email, record.teacherId, record.studentId, record.username].filter(Boolean).map((value) => String(value).trim().toLowerCase());
      return values.includes(normalizedIdentifier.toLowerCase());
    });
    return matches.length > 0 ? { id: matches[0].id, ...matches[0].data() } : null;
  }

  if (!prisma || prisma.__stub) return null;

  const tenant = await prisma.tenant.findUnique({ where: { schoolId: tenantId } });
  if (!tenant) return null;

  return prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      OR: [
        { email: normalizedIdentifier.toLowerCase() },
        { teacherId: normalizedIdentifier },
        { studentId: normalizedIdentifier },
      ],
    },
  });
}

async function validateUserByEmail(tenantId, email, password) {
  const user = await findUserByIdentifier(tenantId, email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

async function createFirebaseUserIfConfigured(email, password, displayName) {
  if (!firebaseAdmin || !firebaseAdmin.isFirebaseConfigured()) return null;
  try {
    const createPayload = { email, displayName };
    if (password) {
      createPayload.password = password;
    }
    return await firebaseAdmin.createUser(createPayload);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return firebaseAdmin.getUserByEmail(email);
    }
    throw err;
  }
}

async function createSessionForUser(user) {
  if (!user) throw new Error('Invalid user');
  if (user.status !== 'active') throw new Error('User account is not active');
  if (user.passwordSyncPending === true) throw new Error('Password update is still being synchronized.');

  const payload = {
    userId: user.id,
    tenantId: user.tenantId || user.schoolId || null,
    roles: normalizeRoles(user),
    platformAdmin: user.platformAdmin === true,
    passwordNeedsReset: user.passwordNeedsReset === true,
  };
  if (firebaseData.isFirebaseDataConfigured()) {
    const sessionId = crypto.randomUUID();
    const firestore = firebaseData.getFirestore();
    const userRef = firestore.collection('users').doc(String(user.id));
    const sessions = firestore.collection('authSessions');
    const sessionRef = sessions.doc(sessionId);
    const refreshToken = signRefreshToken({ userId: user.id, sessionId });
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

    await firestore.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists || userSnapshot.data()?.status !== 'active') throw new Error('User account is not active');
      if (userSnapshot.data()?.passwordSyncPending === true) throw new Error('Password update is still being synchronized.');
      const activeIds = Array.isArray(userSnapshot.data()?.activeSessionIds) ? userSnapshot.data().activeSessionIds : [];
      const activeReferences = activeIds.map((id) => sessions.doc(String(id)));
      const activeSnapshots = await Promise.all(activeReferences.map((reference) => transaction.get(reference)));
      const activeSessions = activeSnapshots
        .map((snapshot, index) => ({ snapshot, reference: activeReferences[index], data: snapshot.exists ? snapshot.data() : null }))
        .filter(({ data }) => data && data.revoked !== true && Number(data.expiresAt) > now)
        .sort((left, right) => Number(left.data.createdAt) - Number(right.data.createdAt));

      while (activeSessions.length >= 2) {
        const oldest = activeSessions.shift();
        transaction.update(oldest.reference, { revoked: true, revokedAt: now });
      }
      transaction.create(sessionRef, { userId: String(user.id), tokenHash: hashToken(refreshToken), createdAt: now, expiresAt, revoked: false });
      transaction.update(userRef, { activeSessionIds: [...activeSessions.map(({ snapshot }) => snapshot.id), sessionId] });
    });

    payload.sessionId = sessionId;
    user.roles = payload.roles;
    return { accessToken: signAccessToken(payload), refreshToken, user };
  }

  if (prisma && !prisma.__stub) {
    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } }).catch(() => []);
    payload.roles = roles.map((r) => r.role.name);

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ userId: user.id });
    const tokenHash = hashToken(refreshToken);

    await prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
    }).catch((err) => {
      console.warn('Failed to persist refresh token:', err);
    });

    try {
      const activeTokens = await prisma.refreshToken.findMany({
        where: { userId: user.id, revoked: false },
        orderBy: { createdAt: 'asc' },
      });
      const MAX_SESSIONS = 2;
      if (activeTokens.length > MAX_SESSIONS) {
        const numToRevoke = activeTokens.length - MAX_SESSIONS;
        const revokeIds = activeTokens.slice(0, numToRevoke).map((t) => t.id);
        await prisma.refreshToken.updateMany({ where: { id: { in: revokeIds } }, data: { revoked: true } }).catch((err) => {
          console.warn('Failed to revoke old refresh tokens:', err);
        });
      }
    } catch (err) {
      // If Prisma is not configured or an error occurs, continue without enforcing sessions.
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch((err) => {
      console.warn('Failed to update last login:', err);
    });

    user.roles = payload.roles;
    return { accessToken, refreshToken, user };
  }

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ userId: user.id });
  user.roles = payload.roles;
  return { accessToken, refreshToken, user };
}

async function findUserByEmail(email) {
  if (firebaseData.isFirebaseDataConfigured()) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;
    const snapshot = await firebaseData.getFirestore().collection('users').where('email', '==', normalized).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  if (!prisma || prisma.__stub) return null;
  return prisma.user.findUnique({ where: { email } });
}

async function findTenantBySchoolId(tenantId) {
  if (firebaseData.isFirebaseDataConfigured()) {
    return firebaseCore.getTenant(tenantId);
  }
  if (!prisma || prisma.__stub) return null;
  return prisma.tenant.findUnique({ where: { schoolId: tenantId } });
}

function normalizeRoles(user = {}) {
  return Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean);
}

function isPlatformAdminIdentity(user = {}) {
  return user.platformAdmin === true || normalizeRoles(user)
    .some((role) => String(role).trim().toLowerCase() === 'super_admin');
}

function identifierMatchesUser(user = {}, identifier = '') {
  const normalized = String(identifier || '').trim().toLowerCase();
  return [user.email, user.teacherId, user.studentId, user.username]
    .filter(Boolean)
    .some((value) => String(value).trim().toLowerCase() === normalized);
}

function roleMatchesLoginType(user = {}, loginType = '') {
  const type = String(loginType || '').trim().toLowerCase();
  const roles = normalizeRoles(user).map((role) => String(role).trim().toLowerCase());
  if (!type) return true;
  if (type === 'teacher') return roles.includes('teacher');
  if (type === 'student') return roles.includes('student');
  if (['school', 'school_authority', 'school_head'].includes(type)) return roles.some((role) => ['school_authority', 'school_head'].includes(role));
  return type === 'platform_admin' ? roles.includes('super_admin') : true;
}

async function syncFirebaseClaims(user, uid, options = {}) {
  if (!uid || typeof firebaseAdmin?.setCustomUserClaims !== 'function') return;
  const roles = normalizeRoles(user).map((role) => String(role).trim().toLowerCase()).filter(Boolean);
  const hasSuperAdminRole = roles.includes('super_admin');
  const isTrustedPlatformAdmin = options.allowPlatformAdmin === true &&
    hasSuperAdminRole && user.platformAdmin === true && !user.tenantId && !user.schoolId;
  if (isPlatformAdminIdentity(user) && !isTrustedPlatformAdmin) {
    throw new Error('Platform administrator claims can only be synchronized through the dedicated platform login.');
  }
  if (options.allowPlatformAdmin === true && !isTrustedPlatformAdmin) {
    throw new Error('The existing record is not an eligible platform administrator.');
  }
  const sync = {
    tenantId: user.schoolId || user.tenantId || null,
    schoolId: user.schoolId || user.tenantId || null,
    role: roles[0] || null,
    roles,
    platformAdmin: isTrustedPlatformAdmin,
  };
  if (isTrustedPlatformAdmin) {
    sync.role = 'super_admin';
  }
  await firebaseAdmin.setCustomUserClaims(uid, sync);
}

async function findFirebaseUserForLogin(tenantId, decoded, options = {}) {
  const users = await firebaseCore.listBySchool('users', tenantId);
  const email = String(decoded.email || '').trim().toLowerCase();
  const identifier = String(options.identifier || '').trim();
  const linked = users.find((candidate) => (candidate.firebaseUid === decoded.uid || candidate.googleUid === decoded.uid) && roleMatchesLoginType(candidate, options.loginType));
  if (linked) return linked;

  const matched = users.find((candidate) => (
    roleMatchesLoginType(candidate, options.loginType) &&
    identifierMatchesUser(candidate, identifier) &&
    String(candidate.email || '').trim().toLowerCase() === email
  ));
  if (!matched) return null;
  if (isPlatformAdminIdentity(matched)) {
    throw new Error('Platform administrators cannot be linked through tenant Firebase login.');
  }
  const linkedUser = await firebaseCore.saveById('users', matched.id, {
    firebaseUid: decoded.uid,
    googleEmail: email,
    authProvider: 'google.com',
    emailVerified: true,
  });
  await syncFirebaseClaims(linkedUser, decoded.uid);
  return linkedUser;
}

async function linkFirebaseIdentity(idToken, userId, tenantId) {
  if (!firebaseAdmin || !firebaseAdmin.isFirebaseConfigured()) throw new Error('Firebase authentication is not configured.');
  const decoded = await firebaseAdmin.verifyIdToken(idToken);
  const user = await firebaseCore.getById('users', userId);
  if (!decoded?.uid || !user || user.status !== 'active' || String(user.schoolId || user.tenantId) !== String(tenantId)) {
    throw new Error('User account was not found in the requested tenant.');
  }
  if (isPlatformAdminIdentity(user)) {
    throw new Error('Platform administrators cannot link identities through a tenant account.');
  }
  const users = await firebaseCore.listBySchool('users', tenantId);
  if (users.some((candidate) => candidate.id !== user.id && (candidate.firebaseUid === decoded.uid || candidate.googleUid === decoded.uid))) {
    throw new Error('That Google account is already linked to another user.');
  }
  const linkedUser = await firebaseCore.saveById('users', user.id, {
    firebaseUid: decoded.uid,
    googleEmail: String(decoded.email || '').trim().toLowerCase() || null,
    authProvider: 'google.com',
  });
  await syncFirebaseClaims(linkedUser, decoded.uid);
  return linkedUser;
}

async function login(tenantId, identifier, password, options = {}) {
  if (firebaseData.isFirebaseDataConfigured()) {
    const tenant = await findTenantBySchoolId(tenantId);
    if (!tenant) throw new Error('Tenant not found');
    const legacyStatus = String(tenant.status || '').trim().toLowerCase();
    const schoolStatus = String(tenant.schoolStatus || (['trial', 'expired'].includes(legacyStatus) ? 'active' : legacyStatus) || 'active').trim().toLowerCase();
    const subscriptionStatus = String(tenant.subscriptionStatus || (!tenant.schoolStatus && ['trial', 'expired'].includes(legacyStatus) ? legacyStatus : 'active')).trim().toLowerCase();
    const isTrialPlan = /trial/i.test(String(tenant.subscriptionPlan || ''));
    const trialEndsAt = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null;
    const trialExpired = ['trial', 'expired'].includes(subscriptionStatus) &&
      (subscriptionStatus === 'trial' || isTrialPlan) &&
      trialEndsAt && !Number.isNaN(trialEndsAt.getTime()) && trialEndsAt.getTime() <= Date.now();
    if (['suspended', 'inactive', 'blocked', 'disabled'].includes(schoolStatus) ||
        ['suspended', 'inactive', 'blocked', 'disabled'].includes(subscriptionStatus) || trialExpired) {
      throw new Error('School account is not active');
    }
  }

  let user = await validateUserByEmail(tenantId, identifier, password);
  if (!user) throw new Error('Invalid credentials');
  if (user.passwordSyncPending === true) throw new Error('Password update is still being synchronized.');
  if (user.status !== 'active' || !roleMatchesLoginType(user, options.loginType)) throw new Error('Invalid credentials');
  if (firebaseData.isFirebaseDataConfigured() && user.isVerified !== true) {
    let firebaseUser = null;
    try {
      firebaseUser = await firebaseAdmin.getUserByEmail(user.email || identifier);
    } catch {
      throw new Error('Email must be verified before signing in.');
    }
    if (firebaseUser?.emailVerified !== true) throw new Error('Email must be verified before signing in.');

    const verifiedRecord = await firebaseCore.saveById('users', user.id, {
      isVerified: true,
      emailVerified: true,
      firebaseUid: firebaseUser.uid,
    }, true);
    user = { ...user, ...verifiedRecord, isVerified: true, emailVerified: true };
  }
  if (user.isVerified !== true) throw new Error('Email must be verified before signing in.');
  user.roles = normalizeRoles(user);

  return createSessionForUser(user);
}

async function loginPlatformAdmin(identifier, password) {
  if (!firebaseData.isFirebaseDataConfigured()) throw new Error('Firebase platform login is not configured.');
  const email = String(identifier || '').trim().toLowerCase();
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active' || user.isVerified !== true || user.platformAdmin !== true ||
      !normalizeRoles(user).includes('super_admin') || user.tenantId || user.schoolId ||
      !(await bcrypt.compare(String(password || ''), user.passwordHash || ''))) {
    throw new Error('Invalid credentials');
  }

  const firebaseUser = await firebaseAdmin.getUserByEmail(email);
  const existingFirebaseUid = String(user.firebaseUid || '').trim();
  if (existingFirebaseUid && existingFirebaseUid !== String(firebaseUser.uid || '').trim()) {
    throw new Error('Platform administrator identity does not match.');
  }

  if (existingFirebaseUid) {
    await syncFirebaseClaims(user, existingFirebaseUid, { allowPlatformAdmin: true });
  }

  const refreshedUser = existingFirebaseUid && typeof firebaseAdmin.getUser === 'function'
    ? await firebaseAdmin.getUser(existingFirebaseUid)
    : firebaseUser;
  const claims = refreshedUser.customClaims || {};
  const claimRoles = Array.isArray(claims.roles) ? claims.roles : [];
  if (refreshedUser.disabled || claims.role !== 'super_admin' || !claimRoles.includes('super_admin') || claims.platformAdmin !== true) {
    throw new Error('Platform administrator claims are not valid.');
  }

  user.roles = ['super_admin'];
  user.platformAdmin = true;
  return createSessionForUser(user);
}

async function loginWithFirebaseIdToken(idToken, tenantId, options = {}) {
  if (options.platformAdminMode === true) {
    throw new Error('Use the dedicated platform administrator login.');
  }
  if (!firebaseAdmin || !firebaseAdmin.isFirebaseConfigured()) {
    throw new Error('Firebase authentication is not configured.');
  }

  const decoded = await firebaseAdmin.verifyIdToken(idToken, true);
  if (!decoded || !decoded.email) {
    throw new Error('Invalid Firebase ID token.');
  }

  const tenant = await findTenantBySchoolId(tenantId);
  if (!tenant) throw new Error('Tenant not found.');

  const firebaseMode = firebaseData.isFirebaseDataConfigured();
  let user = firebaseMode
    ? await findFirebaseUserForLogin(tenantId, decoded, options)
    : await findUserByEmail(decoded.email);
  if (!user) {
    throw new Error('Google account not recognized. Contact your administrator.');
  }
  if (user.passwordSyncPending === true) throw new Error('Password update is still being synchronized.');

  if (!firebaseMode && tenant.id !== user.tenantId) {
    throw new Error('User does not belong to the requested tenant.');
  }

  const roles = firebaseMode
    ? normalizeRoles(user)
    : (await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } }).catch(() => [])).map((entry) => entry.role.name);
  user.roles = roles;
  if (isPlatformAdminIdentity(user)) {
    throw new Error('Platform administrators cannot use tenant Firebase login.');
  }
  if (firebaseMode && user.firebaseUid) await syncFirebaseClaims(user, user.firebaseUid);

  if (!firebaseMode && !user.isVerified && decoded.email_verified) {
    await prisma.user.update({ where: { id: user.id }, data: { isVerified: true } }).catch(() => null);
    user.isVerified = true;
  }

  const session = await createSessionForUser(user);
  return {
    ...session,
    tenantId: user.tenantId,
    schoolId: tenant.schoolId,
  };
}

async function refresh(refreshToken) {
  if (!refreshToken) {
    throw new Error('Refresh token is required');
  }

  try {
    verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new Error('Invalid or expired refresh token');
  }

  if (firebaseData.isFirebaseDataConfigured()) {
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded.userId || !decoded.sessionId) throw new Error('Invalid refresh token');
    const firestore = firebaseData.getFirestore();
    const userRef = firestore.collection('users').doc(String(decoded.userId));
    const sessionRef = firestore.collection('authSessions').doc(String(decoded.sessionId));
    const nextRefreshToken = signRefreshToken({ userId: decoded.userId, sessionId: decoded.sessionId });
    const nextHash = hashToken(nextRefreshToken);
    let accessToken;

    await firestore.runTransaction(async (transaction) => {
      const [sessionSnapshot, userSnapshot] = await Promise.all([transaction.get(sessionRef), transaction.get(userRef)]);
      const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
      const user = userSnapshot.exists ? userSnapshot.data() : null;
      if (!session || session.revoked || session.userId !== String(decoded.userId) || session.tokenHash !== hashToken(refreshToken) || Number(session.expiresAt) <= Date.now() || !user || user.status !== 'active') {
        throw new Error('Invalid refresh token');
      }
      const roles = normalizeRoles(user).map((role) => String(role).trim().toLowerCase()).filter(Boolean);
      if (!roles.length) throw new Error('User roles are no longer active');
      accessToken = signAccessToken({
        userId: String(decoded.userId),
        tenantId: user.tenantId || user.schoolId || null,
        roles,
        platformAdmin: user.platformAdmin === true,
        passwordNeedsReset: user.passwordNeedsReset === true,
        sessionId: String(decoded.sessionId),
      });
      transaction.update(sessionRef, { tokenHash: nextHash, refreshedAt: Date.now() });
    });

    return { accessToken, refreshToken: nextRefreshToken };
  }

  if (!prisma || prisma.__stub) {
    const decoded = verifyRefreshToken(refreshToken);
    return {
      accessToken: signAccessToken({ userId: decoded.userId, tenantId: decoded.tenantId || null, roles: [], passwordNeedsReset: false }),
      refreshToken: signRefreshToken({ userId: decoded.userId }),
    };
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({ where: { tokenHash, revoked: false } });
  if (!stored) throw new Error('Invalid refresh token');

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) throw new Error('Invalid refresh token');

  const payload = { userId: user.id, tenantId: user.tenantId, roles: [], passwordNeedsReset: user.passwordNeedsReset === true };
  const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } }).catch(() => []);
  payload.roles = roles.map((r) => r.role.name);

  const accessToken = signAccessToken(payload);
  const newRefreshToken = signRefreshToken({ userId: user.id });

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } }).catch((err) => {
    console.warn('Failed to revoke old refresh token:', err);
  });

  const newTokenHash = hashToken(newRefreshToken);
  await prisma.refreshToken.create({
    data: {
      tokenHash: newTokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  }).catch((err) => {
    console.warn('Failed to persist new refresh token:', err);
  });

  return { accessToken, refreshToken: newRefreshToken };
}

async function logout(userId, refreshToken) {
  if (firebaseData.isFirebaseDataConfigured()) {
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      return true;
    }
    if (String(decoded.userId) !== String(userId) || !decoded.sessionId) return true;
    const firestore = firebaseData.getFirestore();
    const userRef = firestore.collection('users').doc(String(userId));
    const sessionRef = firestore.collection('authSessions').doc(String(decoded.sessionId));
    await firestore.runTransaction(async (transaction) => {
      const [sessionSnapshot, userSnapshot] = await Promise.all([transaction.get(sessionRef), transaction.get(userRef)]);
      if (!sessionSnapshot.exists) return;
      const session = sessionSnapshot.data();
      if (session.userId !== String(userId) || session.tokenHash !== hashToken(refreshToken)) return;
      transaction.update(sessionRef, { revoked: true, revokedAt: Date.now() });
      if (userSnapshot.exists) {
        const activeIds = Array.isArray(userSnapshot.data()?.activeSessionIds) ? userSnapshot.data().activeSessionIds : [];
        transaction.update(userRef, { activeSessionIds: activeIds.filter((id) => String(id) !== String(decoded.sessionId)) });
      }
    });
    return true;
  }

  if (!prisma || prisma.__stub) return true;
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({ where: { userId, tokenHash }, data: { revoked: true } }).catch((err) => {
    console.warn('Failed to revoke refresh token on logout:', err);
  });
  return true;
}

async function changePassword(userId, oldPassword, newPassword) {
  if (firebaseData.isFirebaseDataConfigured()) {
    if (!isStrongPassword(newPassword)) throw new Error('New password must be at least 8 characters and include uppercase, lowercase, number, and symbol.');
    const firestore = firebaseData.getFirestore();
    const userRef = firestore.collection('users').doc(String(userId));
    const passwordHash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);
    let updatedUser;

    await firestore.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists || userSnapshot.data()?.status !== 'active') throw new Error('User not found');
      const user = { id: userSnapshot.id, ...userSnapshot.data() };
      if (user.passwordSyncPending === true) throw new Error('Password update is still being synchronized.');
      if (!(await bcrypt.compare(oldPassword, user.passwordHash || ''))) throw new Error('Invalid current password');
      const passwordChangedAt = new Date().toISOString();
      const activeSessionIds = Array.isArray(user.activeSessionIds) ? user.activeSessionIds : [];
      const activeSessionRefs = activeSessionIds.map((sessionId) => firestore.collection('authSessions').doc(String(sessionId)));
      const activeSessionSnapshots = await Promise.all(activeSessionRefs.map((sessionRef) => transaction.get(sessionRef)));
      activeSessionSnapshots.forEach((sessionSnapshot, index) => {
        if (sessionSnapshot.exists && sessionSnapshot.data()?.revoked !== true) {
          transaction.update(activeSessionRefs[index], { revoked: true, revokedAt: Date.now() });
        }
      });
      transaction.update(userRef, { passwordHash, passwordNeedsReset: false, passwordChangedAt, passwordSyncPending: true, activeSessionIds: [] });
      updatedUser = { ...user, passwordHash, passwordNeedsReset: false, passwordChangedAt, passwordSyncPending: true, activeSessionIds: [] };
    });

    await syncFirebasePassword(updatedUser, newPassword);
    await clearFirebasePasswordSyncPending(userId, passwordHash);
    updatedUser.passwordSyncPending = false;
    return createSessionForUser(updatedUser);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) throw new Error('Invalid current password');
  if (!isStrongPassword(newPassword)) throw new Error('New password must be at least 8 characters and include uppercase, lowercase, number, and symbol.');
  const hash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash, passwordNeedsReset: false, passwordChangedAt: new Date() } });
  await prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }).catch((err) => {
    console.warn('Failed to revoke refresh tokens after password change:', err);
  });
  const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
  return createSessionForUser(updatedUser);
}

async function forgotPassword(email, options = {}) {
  if (firebaseData.isFirebaseDataConfigured()) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return true;

    const firestore = firebaseData.getFirestore();
    const userSnapshot = await firestore.collection('users').where('email', '==', normalizedEmail).get();
    const requestedLoginType = String(options.loginType || 'school').trim().toLowerCase();
    const matches = userSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((user) => {
        if (user.status !== 'active') return false;
        const roles = normalizeRoles(user).map((role) => String(role).trim().toLowerCase());
        const isPlatformAdmin = user.platformAdmin === true && roles.includes('super_admin') && !user.tenantId && !user.schoolId;
        if (requestedLoginType === 'platform_admin') return isPlatformAdmin;
        if (isPlatformAdmin || roles.includes('super_admin')) return false;
        if (requestedLoginType === 'teacher' || requestedLoginType === 'student') return roles.includes(requestedLoginType);
        return true;
      });
    if (matches.length !== 1 || typeof options.deliverResetToken !== 'function') return true;

    const user = matches[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const tokenRef = firestore.collection('passwordResetTokens').doc(tokenHash);
    const now = Date.now();
    await firestore.runTransaction(async (transaction) => {
      transaction.create(tokenRef, {
        userId: user.id,
        email: normalizedEmail,
        createdAt: now,
        expiresAt: now + config.tokens.emailTokenMinutes * 60 * 1000,
        used: false,
      });
    });

    try {
      await options.deliverResetToken(token);
    } catch (error) {
      await firestore.runTransaction(async (transaction) => {
        const tokenSnapshot = await transaction.get(tokenRef);
        if (tokenSnapshot.exists && tokenSnapshot.data()?.used !== true) {
          transaction.update(tokenRef, { revoked: true, revokedAt: Date.now() });
        }
      });
      throw error;
    }
    return true;
  }

  // Find user then create email token
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return true; // do not reveal whether user exists

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.tokens.emailTokenMinutes * 60 * 1000);
  await prisma.emailToken.create({ data: { tokenHash, type: 'RESET', userId: user.id, expiresAt } }).catch((err) => {
    console.warn('Unable to persist email reset token:', err);
  });
  return token; // caller should send email
}

async function verifyFirebaseIdToken(idToken) {
  if (!firebaseAdmin || !firebaseAdmin.isFirebaseConfigured()) {
    throw new Error('Firebase authentication is not configured.');
  }
  return firebaseAdmin.verifyIdToken(idToken);
}

async function syncFirebasePassword(user, password) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) throw new Error('Firebase account email is unavailable; password update cannot be synchronized.');

  const firebaseUser = await firebaseAdmin.getUserByEmail(email);
  const storedUid = String(user.firebaseUid || '').trim();
  if (!firebaseUser?.uid || String(firebaseUser.email || '').trim().toLowerCase() !== email ||
      (storedUid && storedUid !== String(firebaseUser.uid))) {
    throw new Error('Firebase account identity does not match; password update cannot be synchronized.');
  }

  await firebaseAdmin.updateUser(firebaseUser.uid, { password });
  await firebaseAdmin.revokeRefreshTokens(firebaseUser.uid);
}

async function clearFirebasePasswordSyncPending(userId, passwordHash) {
  const firestore = firebaseData.getFirestore();
  const userRef = firestore.collection('users').doc(String(userId));
  await firestore.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists || userSnapshot.data()?.passwordHash !== passwordHash ||
        userSnapshot.data()?.passwordSyncPending !== true) {
      throw new Error('Password update changed during Firebase synchronization.');
    }
    transaction.update(userRef, { passwordSyncPending: false });
  });
}

async function resetPassword(token, newPassword) {
  if (firebaseData.isFirebaseDataConfigured()) {
    if (!token) throw new Error('Invalid or expired token');
    if (!isStrongPassword(newPassword)) throw new Error('New password must be at least 8 characters and include uppercase, lowercase, number, and symbol.');
    const firestore = firebaseData.getFirestore();
    const tokenHash = hashToken(token);
    const tokenRef = firestore.collection('passwordResetTokens').doc(tokenHash);
    const passwordHash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);
    const now = Date.now();
    const passwordChangedAt = new Date(now).toISOString();

    let updatedUser;
    await firestore.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef);
      const record = tokenSnapshot.exists ? tokenSnapshot.data() : null;
      if (!record || record.used === true || record.revoked === true || Number(record.expiresAt) <= now || !record.userId) {
        throw new Error('Invalid or expired token');
      }

      const userRef = firestore.collection('users').doc(String(record.userId));
      const userSnapshot = await transaction.get(userRef);
      const user = userSnapshot.exists ? userSnapshot.data() : null;
      if (!user || user.status !== 'active' || String(user.email || '').trim().toLowerCase() !== String(record.email || '').trim().toLowerCase()) {
        throw new Error('Invalid or expired token');
      }
      if (user.passwordSyncPending === true) throw new Error('Password update is still being synchronized.');

      const activeSessionIds = Array.isArray(user.activeSessionIds) ? user.activeSessionIds : [];
      const activeSessionRefs = activeSessionIds.map((sessionId) => firestore.collection('authSessions').doc(String(sessionId)));
      const activeSessionSnapshots = await Promise.all(activeSessionRefs.map((sessionRef) => transaction.get(sessionRef)));
      activeSessionSnapshots.forEach((sessionSnapshot, index) => {
        if (sessionSnapshot.exists && sessionSnapshot.data()?.revoked !== true) {
          transaction.update(activeSessionRefs[index], { revoked: true, revokedAt: now });
        }
      });
      transaction.update(userRef, { passwordHash, passwordNeedsReset: false, passwordChangedAt, passwordSyncPending: true, activeSessionIds: [] });
      updatedUser = { ...user, id: String(record.userId), email: record.email, passwordHash, passwordSyncPending: true };
    });
    await syncFirebasePassword(updatedUser, newPassword);
    await firestore.runTransaction(async (transaction) => {
      const [userSnapshot, tokenSnapshot] = await Promise.all([transaction.get(firestore.collection('users').doc(String(updatedUser.id))), transaction.get(tokenRef)]);
      if (!userSnapshot.exists || userSnapshot.data()?.passwordHash !== passwordHash || userSnapshot.data()?.passwordSyncPending !== true ||
          !tokenSnapshot.exists || tokenSnapshot.data()?.used === true) {
        throw new Error('Password update changed during Firebase synchronization.');
      }
      transaction.update(firestore.collection('users').doc(String(updatedUser.id)), { passwordSyncPending: false });
      transaction.update(tokenRef, { used: true, usedAt: now });
    });
    return true;
  }

  const tokenHash = hashToken(token);
  const record = await prisma.emailToken.findFirst({ where: { tokenHash, type: 'RESET', used: false, expiresAt: { gt: new Date() } } });
  if (!record) throw new Error('Invalid or expired token');
  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw new Error('Invalid token');
  const hash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);
  if (!isStrongPassword(newPassword)) throw new Error('New password must be at least 8 characters and include uppercase, lowercase, number, and symbol.');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash, passwordNeedsReset: false, passwordChangedAt: new Date() } });
  await prisma.emailToken.update({ where: { id: record.id }, data: { used: true } }).catch((err) => {
    console.warn('Unable to mark reset token as used:', err);
  });
  return true;
}

module.exports = { validateUserByEmail, login, loginPlatformAdmin, refresh, logout, changePassword, forgotPassword, resetPassword, loginWithFirebaseIdToken, verifyFirebaseIdToken, linkFirebaseIdentity };
