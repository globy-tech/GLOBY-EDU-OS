const crypto = require('crypto');
const express = require('express');
const authMiddleware = require('../modules/auth/middleware/auth.middleware');
const firebaseData = require('../firebase.data');
const { loadSchoolData, saveSchoolData } = require('../modules/school/fallback.school');
const { isProductionRuntime } = require('../config/app-url.config');
const {
  uploadSchoolFile,
  deleteSchoolFile,
  createSchoolFileSignedUrl,
  isR2Configured,
  getR2ConfigurationStatus,
} = require('../lib/supabaseClient');

const router = express.Router();
const MAX_FILE_UPLOAD_BYTES = 20 * 1024 * 1024;
const rawUploadParser = express.raw({ type: '*/*', limit: MAX_FILE_UPLOAD_BYTES });
const ROLE_CONFIG = Object.freeze({
  school_authority: new Set(['school_authority', 'school_head']),
  super_admin: new Set(['super_admin']),
});

function getRoles(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [user?.role].filter(Boolean);
  return new Set(roles.map((role) => String(role).trim().toLowerCase()));
}

function getAuthenticatedProfileRole(user) {
  const roles = getRoles(user);
  if ([...ROLE_CONFIG.school_authority].some((role) => roles.has(role)) &&
      user?.tenantId && (!user?.schoolId || user.tenantId === user.schoolId)) {
    return 'school_authority';
  }
  if (roles.has('super_admin') && user?.platformAdmin === true && !user?.tenantId && !user?.schoolId) {
    return 'super_admin';
  }
  return null;
}

function isValidImage(contentType, body) {
  const signatures = {
    'image/jpeg': (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/png': (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/gif': (data) => ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii')),
    'image/webp': (data) => data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP',
  };
  return Boolean(signatures[contentType]?.(body));
}

function getR2ConfigurationMessage() {
  const status = getR2ConfigurationStatus();
  const issues = [
    ...status.missingVariables.map((variable) => `missing ${variable}`),
    ...status.invalidVariables.map((variable) => `invalid ${variable}`),
  ];
  return issues.length
    ? `Cloudflare R2 configuration is unavailable on this server. Check: ${issues.join(', ')}.`
    : 'Cloudflare R2 is required for production file storage.';
}

function findFallbackAccount(userId) {
  const separator = String(userId || '').indexOf(':');
  if (separator <= 0) return null;
  const schoolId = userId.slice(0, separator);
  const username = userId.slice(separator + 1).toLowerCase();
  const schools = loadSchoolData();
  const school = schools.find((entry) => String(entry.schoolId || entry.id) === schoolId);
  const account = school?.users?.find((entry) =>
    String(entry.username || entry.email || '').trim().toLowerCase() === username
  );
  return account && school ? {
    account,
    school,
    schools,
    tenantId: getRoles(account).has('super_admin') ? null : String(school.schoolId || school.id || ''),
  } : null;
}

async function loadAuthenticatedAccount(req) {
  const userId = String(req.user?.userId || '');
  if (!userId) return null;

  if (firebaseData.isFirebaseDataConfigured()) {
    const snapshot = await firebaseData.getFirestore().collection('users').doc(userId).get();
    return snapshot.exists ? {
      account: snapshot.data(),
      save: (profilePhotoPath) => snapshot.ref.set({ profilePhotoPath, updatedAt: new Date().toISOString() }, { merge: true }),
    } : null;
  }

  if (isProductionRuntime() || String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() !== 'true') return null;
  const fallback = findFallbackAccount(userId);
  if (!fallback) return null;
  return {
    account: fallback.account,
    tenantId: fallback.tenantId,
    save: async (profilePhotoPath) => {
      fallback.account.profilePhotoPath = profilePhotoPath;
      saveSchoolData(fallback.schools);
    },
  };
}

async function resolveProfile(req) {
  const profileRole = getAuthenticatedProfileRole(req.user);
  if (!profileRole) return null;

  const stored = await loadAuthenticatedAccount(req);
  if (!stored || stored.account.status !== 'active') return null;
  const storedRoles = getRoles(stored.account);
  if (![...ROLE_CONFIG[profileRole]].some((role) => storedRoles.has(role))) return null;
  if (profileRole === 'school_authority') {
    const accountTenant = String(stored.account.tenantId || stored.account.schoolId || '');
    const storedTenant = accountTenant || String(stored.tenantId || '');
    if (!storedTenant || storedTenant !== String(req.user.tenantId) ||
        (accountTenant && accountTenant !== String(req.user.tenantId))) return null;
  } else if (stored.account.platformAdmin !== true ||
      stored.account.tenantId || stored.account.schoolId ||
      req.user.platformAdmin !== true) {
    return null;
  }
  return { ...stored, profileRole };
}

async function removeUnreferencedProfileUpload(req, photoPath, metadata) {
  const latest = await loadAuthenticatedAccount(req);
  if (!latest) throw new Error('Unable to verify the profile photo reference after a failed save.');
  if (String(latest.account.profilePhotoPath || '') === photoPath) return false;
  await deleteSchoolFile(photoPath, metadata || {});
  return true;
}

function sendParserError(error, res, next) {
  if (!error) return next();
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ status: 'error', message: 'This image is too large to upload. Choose a smaller image.' });
  }
  return next(error);
}

router.get('/photo', authMiddleware, async (req, res) => {
  try {
    const profile = await resolveProfile(req);
    if (!profile) return res.status(403).json({ status: 'error', message: 'You are not authorized to access this profile photo.' });
    const photoPath = String(profile.account.profilePhotoPath || '');
    if (!photoPath) return res.json({ status: 'ok', path: null, url: null });
    if (isProductionRuntime() && !isR2Configured()) {
      return res.status(503).json({ status: 'error', message: getR2ConfigurationMessage() });
    }
    const url = await createSchoolFileSignedUrl(photoPath, 3600);
    return res.json({ status: 'ok', path: photoPath, url, expiresIn: 3600 });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Unable to load your profile photo.' });
  }
});

router.post('/photo', authMiddleware, (req, res, next) => {
  rawUploadParser(req, res, (error) => sendParserError(error, res, next));
}, async (req, res) => {
  try {
    const profile = await resolveProfile(req);
    if (!profile) return res.status(403).json({ status: 'error', message: 'You are not authorized to update this profile photo.' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Choose a photo before uploading.' });
    }
    const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!isValidImage(contentType, req.body)) {
      return res.status(400).json({ status: 'error', message: 'Choose a valid JPEG, PNG, GIF, or WebP image.' });
    }
    if (req.body.length > MAX_FILE_UPLOAD_BYTES) {
      return res.status(413).json({ status: 'error', message: 'This image is too large to upload. Choose a smaller image.' });
    }
    if (isProductionRuntime() && !isR2Configured()) {
      return res.status(503).json({ status: 'error', message: getR2ConfigurationMessage() });
    }

    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[contentType];
    const accountIdHash = crypto.createHash('sha256').update(String(req.user.userId)).digest('hex');
    const photoPath = `account-profile/${profile.profileRole}/${accountIdHash}/${crypto.randomUUID()}.${extension}`;
    const uploadMetadata = await uploadSchoolFile(photoPath, req.body, {
      contentType,
      upsert: false,
      returnMetadata: true,
    });
    let url;
    try {
      url = await createSchoolFileSignedUrl(photoPath, 3600);
    } catch (error) {
      try {
        await removeUnreferencedProfileUpload(req, photoPath, uploadMetadata);
      } catch (cleanupError) {
        console.error('Unable to safely clean up an account photo after its download link could not be created.', cleanupError);
        return res.status(500).json({
          status: 'error',
          message: 'A download link could not be created and storage cleanup could not be confirmed. Contact support before retrying.',
        });
      }
      return res.status(500).json({ status: 'error', message: 'Unable to create a download link for the profile photo.' });
    }

    try {
      await profile.save(photoPath);
    } catch (error) {
      try {
        await removeUnreferencedProfileUpload(req, photoPath, uploadMetadata);
      } catch (cleanupError) {
        console.error('Unable to safely clean up an account photo after its profile reference could not be saved.', cleanupError);
        return res.status(500).json({
          status: 'error',
          message: 'The profile photo could not be saved, and storage cleanup could not be confirmed. Contact support before retrying.',
        });
      }
      return res.status(500).json({ status: 'error', message: 'Unable to save your profile photo. Please try again.' });
    }
    return res.status(201).json({ status: 'ok', path: photoPath, url, expiresIn: 3600 });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Unable to save your profile photo. Please try again.' });
  }
});

module.exports = router;
