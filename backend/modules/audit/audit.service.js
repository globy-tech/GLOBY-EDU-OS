const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../../config/prisma.client');
const {
  assertIsolatedQaConfiguration,
  assertTestDataFilePath,
} = require('../../config/qa-config');
const firebaseData = require('../../firebase.data');

const AUDIT_FILE = process.env.GLOBY_AUDIT_FILE
  ? path.resolve(process.env.GLOBY_AUDIT_FILE)
  : path.join(__dirname, '../../data/audit-logs.json');
const SENSITIVE_KEY = /password|hash|token|secret|api[_-]?key|oauth|credential|private/i;
const SENSITIVE_VALUE = /^\$2[aby]\$|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || Boolean(String(process.env.RENDER_SERVICE_ID || '').trim());
}

function assertFallbackAuditAllowed() {
  if (isProductionRuntime()) throw new Error('[audit.service] JSON audit storage is disabled in production.');
  assertIsolatedQaConfiguration();

  const isTestRuntime = process.env.NODE_ENV === 'test';
  const qaMode = String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true';
  if (isTestRuntime) assertTestDataFilePath(process.env, 'GLOBY_AUDIT_FILE');
  if ((isTestRuntime || qaMode) && path.resolve(process.env.GLOBY_AUDIT_FILE) !== AUDIT_FILE) {
    const error = new Error('[audit.service] Audit data path changed after fallback storage was initialized.');
    error.code = 'ERR_UNSAFE_TEST_DATA_PATH';
    throw error;
  }
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined));
  }
  if (typeof value === 'string' && (SENSITIVE_KEY.test(value) || SENSITIVE_VALUE.test(value))) return '[REDACTED]';
  return value;
}

function safeMetadata(metadata = {}) {
  const sanitized = sanitizeValue(metadata);
  return sanitized && typeof sanitized === 'object' ? sanitized : {};
}

function getRequestContext(req) {
  return {
    ipAddress: req?.ip || req?.socket?.remoteAddress || null,
    userAgent: req?.get?.('user-agent') || null,
  };
}

function loadFallbackLogs() {
  assertFallbackAuditAllowed();
  if (!fs.existsSync(AUDIT_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    return Array.isArray(parsed.logs) ? parsed.logs : [];
  } catch (error) {
    return [];
  }
}

function saveFallbackLogs(logs) {
  assertFallbackAuditAllowed();
  fs.writeFileSync(AUDIT_FILE, JSON.stringify({ logs: logs.slice(-2000) }, null, 2), 'utf8');
}

function withDbTimeout(promise, timeoutMs = 800) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Audit database timeout')), timeoutMs);
    }),
  ]);
}

async function recordAuditEvent(event = {}) {
  const metadata = safeMetadata({ ...(event.metadata || {}), ...getRequestContext(event.req) });
  const record = {
    id: event.id || crypto.randomUUID(),
    actorId: event.actorId || null,
    actorRole: event.actorRole || null,
    tenantId: event.tenantId || null,
    action: String(event.action || 'unknown'),
    resourceType: event.resourceType || event.resource || null,
    resourceId: event.resourceId || null,
    success: event.success !== false,
    metadata,
    createdAt: new Date().toISOString(),
  };

  try {
    if (firebaseData.isFirebaseDataConfigured()) {
      await firebaseData.getFirestore().collection('auditLogs').doc(record.id).set(record);
      return record;
    }
    if (prisma && !prisma.__stub && prisma.auditLog?.create) {
      await withDbTimeout(prisma.auditLog.create({
        data: {
          id: record.id,
          actorId: record.actorId,
          actorRole: record.actorRole,
          tenantId: record.tenantId,
          action: record.action,
          resourceType: record.resourceType,
          resourceId: record.resourceId,
          success: record.success,
          metadata: record.metadata,
        },
      }));
      return record;
    }

    saveFallbackLogs([...loadFallbackLogs(), record]);
    return record;
  } catch (error) {
    if (error?.code === 'ERR_UNSAFE_TEST_DATA_PATH') throw error;
    if (isProductionRuntime()) {
      console.error('[audit.service] Durable audit event was not persisted.');
      return record;
    }
    try {
      saveFallbackLogs([...loadFallbackLogs(), record]);
    } catch (persistError) {
      if (persistError?.code === 'ERR_UNSAFE_TEST_DATA_PATH') throw persistError;
      // Audit persistence must not take down the business request.
    }
    return record;
  }
}

async function listAuditEvents({ tenantId, isSuperAdmin = false, limit = 100, actorRole, action, success, since } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const filters = {
    ...(tenantId ? { tenantId } : {}),
    ...(actorRole ? { actorRole } : {}),
    ...(action ? { action } : {}),
    ...(success !== undefined ? { success: success === true || success === 'true' } : {}),
    ...(since ? { createdAt: { gte: new Date(since) } } : {}),
  };
  if (firebaseData.isFirebaseDataConfigured()) {
    let query = firebaseData.getFirestore().collection('auditLogs').orderBy('createdAt', 'desc').limit(take);
    if (!isSuperAdmin && tenantId) query = query.where('tenantId', '==', tenantId);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((entry) => !actorRole || entry.actorRole === actorRole)
      .filter((entry) => !action || entry.action === action)
      .filter((entry) => success === undefined || entry.success === (success === true || success === 'true'))
      .filter((entry) => !since || new Date(entry.createdAt) >= new Date(since));
  }
  if (prisma && !prisma.__stub && prisma.auditLog?.findMany) {
    try {
      const rows = await withDbTimeout(prisma.auditLog.findMany({
        where: isSuperAdmin ? filters : { ...filters, tenantId },
        orderBy: { createdAt: 'desc' },
        take,
      }));
      return rows;
    } catch (error) {
      if (isProductionRuntime()) throw error;
      return loadFallbackLogs()
        .filter((entry) => isSuperAdmin || entry.tenantId === tenantId)
        .filter((entry) => !actorRole || entry.actorRole === actorRole)
        .filter((entry) => !action || entry.action === action)
        .filter((entry) => success === undefined || entry.success === (success === true || success === 'true'))
        .filter((entry) => !since || new Date(entry.createdAt) >= new Date(since))
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .slice(0, take);
    }
  }
  return loadFallbackLogs()
    .filter((entry) => isSuperAdmin || entry.tenantId === tenantId)
    .filter((entry) => !actorRole || entry.actorRole === actorRole)
    .filter((entry) => !action || entry.action === action)
    .filter((entry) => success === undefined || entry.success === (success === true || success === 'true'))
    .filter((entry) => !since || new Date(entry.createdAt) >= new Date(since))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, take);
}

module.exports = { recordAuditEvent, listAuditEvents, safeMetadata };