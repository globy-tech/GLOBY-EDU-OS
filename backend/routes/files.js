const express = require('express');
const authMiddleware = require('../modules/auth/middleware/auth.middleware');
const tenantMiddleware = require('../modules/school/middleware/tenant.middleware');
const schoolService = require('../modules/school/school.service');
const firebaseData = require('../firebase.data');
const {
  uploadSchoolFile,
  createSchoolFileSignedUrl,
  isR2Configured,
  getR2ConfigurationStatus,
} = require('../lib/supabaseClient');

const router = express.Router();
const MIN_SIGNED_URL_SECONDS = 300;
const MAX_SIGNED_URL_SECONDS = 60 * 60;
const MAX_FILE_UPLOAD_BYTES = 20 * 1024 * 1024;
const rawUploadParser = express.raw({ type: '*/*', limit: MAX_FILE_UPLOAD_BYTES });

function parseUploadBody(req, res, next) {
  rawUploadParser(req, res, (error) => {
    if (!error) return next();
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ status: 'error', message: 'This file is too large to upload. Choose a smaller file.' });
    }
    return next(error);
  });
}

function getUserRoles(req) {
  const assignedRoles = Array.isArray(req.user?.roles)
    ? req.user.roles
    : typeof req.user?.roles === 'string'
      ? [req.user.roles]
      : [];
  return new Set([
    ...assignedRoles,
    ...(req.user?.role ? [req.user.role] : []),
  ].map((role) => String(role).trim().toLowerCase()));
}

function validateProfileImage(req, filename, ownerType) {
  const prefix = filename.split('/')[0];
  if (!['student-profile', 'teacher-profile', 'profilePhoto'].includes(prefix)) return null;

  const roles = getUserRoles(req);
  const isStudentPhoto = ownerType === 'student' || prefix === 'student-profile';
  const canUpload = isStudentPhoto
    ? roles.has('student') || roles.has('teacher') || roles.has('school_authority') || roles.has('school_head')
    : roles.has('teacher') || roles.has('school_authority') || roles.has('school_head');
  if (!canUpload) return { status: 403, message: 'You are not authorized to upload this profile photo.' };

  const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const signatures = {
    'image/jpeg': (body) => body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
    'image/png': (body) => body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/gif': (body) => body.subarray(0, 6).toString('ascii') === 'GIF87a' || body.subarray(0, 6).toString('ascii') === 'GIF89a',
    'image/webp': (body) => body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP',
  };

  if (!Object.hasOwn(signatures, contentType) || !signatures[contentType](req.body)) {
    return { status: 400, message: 'Choose a valid JPEG, PNG, GIF, or WebP image.' };
  }
  if (req.body.length > MAX_FILE_UPLOAD_BYTES) {
    return { status: 413, message: 'This image is too large to upload. Choose a smaller image.' };
  }
  return null;
}

function getR2ConfigurationMessage() {
  const status = getR2ConfigurationStatus();
  const issues = [...status.missingVariables, ...status.invalidVariables];
  return issues.length
    ? `Cloudflare R2 configuration is incomplete on this server. Check: ${issues.join(', ')}.`
    : 'Cloudflare R2 is required for production file storage.';
}

function getTenantFolder(req) {
  const tenantId = req.user?.tenantId || req.user?.schoolId;
  if (!tenantId) return null;

  const folder = String(tenantId).trim();
  return /^[A-Za-z0-9_-]+$/.test(folder) ? folder : null;
}

function normalizeRelativePath(value) {
  const filePath = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!filePath || filePath.includes('\0') || filePath.split('/').some((segment) => !segment || segment === '..')) {
    return null;
  }
  return filePath;
}

function getScopedFilePath(req, requestedPath) {
  const tenantFolder = getTenantFolder(req);
  const relativePath = normalizeRelativePath(requestedPath);
  if (!tenantFolder || !relativePath) return null;
  return `${tenantFolder}/${relativePath}`;
}

function getRecordAliases(record = {}) {
  return ['studentId', 'teacherId', 'id', 'username', 'email', 'userId']
    .map((field) => String(record[field] || '').trim().toLowerCase())
    .filter(Boolean);
}

function getActorAliases(user = {}) {
  return ['username', 'email', 'userId', 'uid', 'id']
    .map((field) => String(user[field] || '').trim().toLowerCase())
    .filter(Boolean)
    .flatMap((value) => [value, value.includes(':') ? value.split(':').pop() : value]);
}

function getSchoolRecords(school, entityType) {
  const records = Array.isArray(school[entityType]) ? school[entityType] : [];
  const role = entityType === 'students' ? 'student' : 'teacher';
  const users = (Array.isArray(school.users) ? school.users : []).filter((record) => {
    const roles = Array.isArray(record.roles) ? record.roles : [record.role];
    return record[entityType === 'students' ? 'studentId' : 'teacherId']
      || roles.some((entry) => String(typeof entry === 'string' ? entry : entry?.role?.name || entry?.name || '').toLowerCase() === role);
  });
  const recordAliases = new Set(records.flatMap(getRecordAliases));
  return [
    ...records,
    ...users.filter((record) => !getRecordAliases(record).some((alias) => recordAliases.has(alias))),
  ];
}

function findUniqueRecord(school, entityType, identifier) {
  const requested = String(identifier || '').trim().toLowerCase();
  if (!requested) return null;
  const matches = getSchoolRecords(school, entityType).filter((record) => getRecordAliases(record).includes(requested));
  return matches.length === 1 ? matches[0] : null;
}

function findUniqueActorRecord(school, entityType, req) {
  const actorAliases = new Set(getActorAliases(req.user));
  const matches = getSchoolRecords(school, entityType).filter((record) =>
    getRecordAliases(record).some((alias) => actorAliases.has(alias))
  );
  return matches.length === 1 ? matches[0] : null;
}

function isSchoolAuthority(roles) {
  return roles.has('school_authority') || roles.has('school_head');
}

function isOwnRecord(req, record) {
  const actorAliases = new Set(getActorAliases(req.user));
  return getRecordAliases(record).some((alias) => actorAliases.has(alias));
}

function isTeacherAssignedToStudent(school, req, student) {
  if (!getUserRoles(req).has('teacher')) return false;
  const view = schoolService.getTeacherSchoolView(school, req.user);
  if (!view) return false;
  const studentAliases = new Set(getRecordAliases(student));
  return (Array.isArray(view.students) ? view.students : [])
    .some((record) => getRecordAliases(record).some((alias) => studentAliases.has(alias)));
}

function getSchoolAssetField(relativePath, field) {
  const prefix = relativePath.split('/')[0];
  const allowedFields = {
    'school-assets': ['logoPath', 'coverImagePath', 'stampPath', 'principalSignaturePath'],
    'school-logo': ['logoPath'],
    'school-cover': ['coverImagePath'],
    'school-branding': ['logoPath'],
  };
  return allowedFields[prefix]?.includes(field) ? field : null;
}

async function resolveAuthorizedFile(req, school, relativePath, target = {}) {
  const roles = getUserRoles(req);
  const schoolId = String(school.schoolId || school.id || '');
  if (!schoolId || schoolId !== String(req.user?.tenantId || req.user?.schoolId || '')) return null;

  if (target.ownerType === 'school') {
    const field = getSchoolAssetField(relativePath, target.ownerField);
    if (!field || String(target.ownerId || '') !== schoolId || !isSchoolAuthority(roles)) return null;
    return {
      type: 'school',
      record: school,
      field,
      authorized: true,
    };
  }

  if (target.ownerType !== 'student' && target.ownerType !== 'teacher') return null;
  const entityType = target.ownerType === 'student' ? 'students' : 'teachers';
  const prefix = relativePath.split('/')[0];
  const acceptedPrefixes = target.ownerType === 'student'
    ? new Set(['student-profile', 'profilePhoto'])
    : new Set(['teacher-profile', 'profilePhoto']);
  if (!acceptedPrefixes.has(prefix) || target.ownerField !== 'profilePhotoPath') return null;

  const record = target.ownerId === 'self'
    ? findUniqueActorRecord(school, entityType, req)
    : findUniqueRecord(school, entityType, target.ownerId);
  if (!record) return null;
  let authorized = isSchoolAuthority(roles);
  if (target.ownerType === 'student') {
    authorized = authorized
      || (roles.has('student') && isOwnRecord(req, record))
      || isTeacherAssignedToStudent(school, req, record);
  } else {
    authorized = authorized || (roles.has('teacher') && isOwnRecord(req, record));
  }
  return authorized ? { type: target.ownerType, entityType, record, field: 'profilePhotoPath', authorized: true } : null;
}

function getExistingPathReferences(school, relativePath) {
  const matches = [];
  const schoolFields = ['logoPath', 'coverImagePath', 'stampPath', 'principalSignaturePath'];
  for (const field of schoolFields) {
    if (String(school[field] || '') === relativePath) {
      matches.push({ type: 'school', record: school, field });
    }
  }

  for (const [type, entityType] of [['student', 'students'], ['teacher', 'teachers']]) {
    for (const record of getSchoolRecords(school, entityType)) {
      if (String(record.profilePhotoPath || record.metadata?.profilePhotoPath || '') === relativePath) {
        matches.push({ type, entityType, record, field: 'profilePhotoPath' });
      }
    }
  }
  return matches;
}

async function authorizeExistingPath(req, school, relativePath) {
  const matches = getExistingPathReferences(school, relativePath);
  if (matches.length !== 1) return null;

  const match = matches[0];
  const roles = getUserRoles(req);
  if (match.type === 'school') {
    if (isSchoolAuthority(roles)) return match;
    const tenantBranding = ['logoPath', 'coverImagePath'].includes(match.field)
      && (roles.has('teacher') || roles.has('student'));
    return tenantBranding ? match : null;
  }
  if (match.type === 'student') {
    if (isSchoolAuthority(roles) || (roles.has('student') && isOwnRecord(req, match.record))) return match;
    return isTeacherAssignedToStudent(school, req, match.record) ? match : null;
  }
  if (isSchoolAuthority(roles) || (roles.has('teacher') && isOwnRecord(req, match.record))) return match;
  return null;
}

async function persistFileReference(school, owner, relativePath, actor) {
  if (owner.type === 'school') {
    await schoolService.updateSchool(school.id || school.schoolId, { [owner.field]: relativePath });
    return;
  }

  const identifier = owner.record.studentId || owner.record.teacherId || owner.record.id || owner.record.username || owner.record.email;
  if (owner.type === 'teacher' && getUserRoles({ user: actor }).has('teacher')) {
    const updated = schoolService.updateTeacherWorkspace(school, actor, {
      teacherProfile: { profilePhotoPath: relativePath },
    });
    await schoolService.updateSchool(school.id || school.schoolId, {
      teachers: updated.teachers,
      users: updated.users,
    });
    return;
  }
  await schoolService.updateEntity(school.schoolId || school.id, owner.entityType, identifier, {
    profilePhotoPath: relativePath,
  }, actor);
}

async function getAuthorizedSchool(req) {
  const tenantId = req.user?.tenantId || req.user?.schoolId;
  if (!tenantId) return null;
  const school = await schoolService.getSchoolBySchoolId(tenantId);
  if (!school || String(school.schoolId || school.id || '') !== String(tenantId)) return null;
  return school;
}

router.post('/upload', authMiddleware, parseUploadBody, tenantMiddleware, async (req, res) => {
  try {
    const filename = normalizeRelativePath(req.query.filename);
    const scopedPath = getScopedFilePath(req, filename);
    if (!scopedPath || !req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ status: 'error', message: 'A non-empty file body and valid filename are required.' });
    }
    const school = await getAuthorizedSchool(req);
    const owner = school && await resolveAuthorizedFile(req, school, filename, {
      ownerType: req.query.ownerType,
      ownerId: req.query.ownerId,
      ownerField: req.query.ownerField,
    });
    if (!owner) {
      return res.status(403).json({ status: 'error', message: 'You are not authorized to upload a file for this record.' });
    }
    const existingReferences = getExistingPathReferences(school, filename);
    if (existingReferences.some((reference) => reference.record !== owner.record || reference.field !== owner.field)) {
      return res.status(409).json({ status: 'error', message: 'This storage path is already linked to another record.' });
    }
    const imageError = validateProfileImage(req, filename, owner.type);
    if (imageError) {
      return res.status(imageError.status).json({ status: 'error', message: imageError.message });
    }

    if (process.env.NODE_ENV === 'production') {
      if (!isR2Configured()) {
        return res.status(503).json({ status: 'error', message: getR2ConfigurationMessage() });
      }
      await uploadSchoolFile(scopedPath, req.body, {
        contentType: req.get('content-type') || 'application/octet-stream',
        upsert: false,
      });
    } else if (firebaseData.isFirebaseDataConfigured()) {
      const file = firebaseData.getStorageBucket().file(`tenants/${scopedPath}`);
      await file.save(req.body, {
        contentType: req.get('content-type') || 'application/octet-stream',
        resumable: false,
        validation: 'md5',
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } else {
      await uploadSchoolFile(scopedPath, req.body, {
        contentType: req.get('content-type') || 'application/octet-stream',
        upsert: false,
      });
    }

    await persistFileReference(school, owner, filename, req.user);
    return res.status(201).json({
      status: 'ok',
      path: filename,
      tenantId: req.user.tenantId || req.user.schoolId,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/*', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const scopedPath = getScopedFilePath(req, req.params[0]);
    if (!scopedPath) {
      return res.status(400).json({ status: 'error', message: 'A valid file path is required.' });
    }
    const school = await getAuthorizedSchool(req);
    const owner = school && await authorizeExistingPath(req, school, normalizeRelativePath(req.params[0]));
    if (!owner) {
      return res.status(403).json({ status: 'error', message: 'You are not authorized to access this file.' });
    }

    const expiresIn = Math.min(
      Math.max(Number(req.query.expiresIn) || MAX_SIGNED_URL_SECONDS, MIN_SIGNED_URL_SECONDS),
      MAX_SIGNED_URL_SECONDS
    );
    const production = process.env.NODE_ENV === 'production';
    if (production && !isR2Configured()) {
      return res.status(503).json({ status: 'error', message: getR2ConfigurationMessage() });
    }
    const useR2 = production || !firebaseData.isFirebaseDataConfigured();
    const signedUrl = useR2
      ? await createSchoolFileSignedUrl(scopedPath, expiresIn)
      : (await firebaseData.getStorageBucket().file(`tenants/${scopedPath}`).getSignedUrl({ action: 'read', expires: Date.now() + expiresIn * 1000 }))[0];
    return res.json({ status: 'ok', url: signedUrl, expiresIn, persistent: false });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
