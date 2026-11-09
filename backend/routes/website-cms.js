const crypto = require('crypto');
const express = require('express');
const authMiddleware = require('../modules/auth/middleware/auth.middleware');
const { roleGuard } = require('../modules/auth/middleware/role.middleware');
const firebaseData = require('../firebase.data');
const websiteCMS = require('../modules/platform-admin/website-cms.service');
const { isProductionRuntime } = require('../config/app-url.config');
const {
  uploadSchoolFile,
  createSchoolFileSignedUrl,
  isR2Configured,
  getR2ConfigurationStatus,
} = require('../lib/supabaseClient');

const router = express.Router();
const MAX_LOGO_BYTES = 20 * 1024 * 1024;
const rawUploadParser = express.raw({ type: '*/*', limit: MAX_LOGO_BYTES });
const LOGO_PATH_PATTERN = /^website-branding\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/i;
const DEFAULT_LOGO_URL = websiteCMS.DEFAULT_WEBSITE_CMS.logoUrl;

function isValidLogoPath(value) {
  return typeof value === 'string' && LOGO_PATH_PATTERN.test(value);
}

function isSafeHttpsUrl(value, allowEmpty = false) {
  if (!value) return allowEmpty;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSafeLogoUrl(value) {
  if (value.startsWith('/src/assets/images/')) {
    return !value.split('/').includes('..') && !/[<>"']/.test(value);
  }
  return isSafeHttpsUrl(value);
}

function validateSettings(input, current) {
  const settings = websiteCMS.pickWebsiteCMSSettings(input, current);
  if (!settings.companyName || !settings.heroTitle || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contactEmail)) {
    throw Object.assign(new Error('Company name, hero title, and a valid contact email are required.'), { status: 400 });
  }
  if (!isSafeLogoUrl(settings.logoUrl) || !isSafeHttpsUrl(settings.website) || !isSafeHttpsUrl(settings.googleMapsUrl)) {
    throw Object.assign(new Error('Logo, website, and map links must use an allowed local asset path or HTTPS URL.'), { status: 400 });
  }
  if (!/^#[0-9a-f]{6}$/i.test(settings.themeColor)) {
    throw Object.assign(new Error('Theme color must be a six-digit hexadecimal color.'), { status: 400 });
  }
  if (settings.logoPath && !isValidLogoPath(settings.logoPath)) {
    throw Object.assign(new Error('The website logo path is invalid.'), { status: 400 });
  }
  if (settings.logoPath) settings.logoUrl = DEFAULT_LOGO_URL;
  return settings;
}

function publicSettings(settings) {
  const { logoPath, ...publishedSettings } = settings;
  return publishedSettings;
}

async function getLogoUrl(settings) {
  if (!isValidLogoPath(settings.logoPath)) return settings.logoUrl || DEFAULT_LOGO_URL;
  try {
    if (!isProductionRuntime() && firebaseData.isFirebaseDataConfigured()) {
      const file = firebaseData.getStorageBucket().file(settings.logoPath);
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 });
      return url;
    }
    return await createSchoolFileSignedUrl(settings.logoPath, 3600);
  } catch {
    return DEFAULT_LOGO_URL;
  }
}

async function getResponseSettings(includePath) {
  const record = await websiteCMS.getWebsiteCMSRecord();
  const settings = { ...record.settings, logoUrl: await getLogoUrl(record.settings) };
  return includePath ? settings : publicSettings(settings);
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

function imageExtension(contentType, body) {
  const signatures = {
    'image/jpeg': (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/png': (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/gif': (data) => ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii')),
    'image/webp': (data) => data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP',
  };
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  return signatures[contentType]?.(body) ? extensions[contentType] : null;
}

async function saveBrandingLogo(filePath, body, contentType) {
  if (isProductionRuntime()) {
    if (!isR2Configured()) {
      throw Object.assign(new Error(getR2ConfigurationMessage()), { status: 503 });
    }
    await uploadSchoolFile(filePath, body, { contentType, upsert: false });
    return;
  }

  if (firebaseData.isFirebaseDataConfigured()) {
    await firebaseData.getStorageBucket().file(filePath).save(body, {
      contentType,
      resumable: false,
      validation: 'md5',
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    return;
  }

  await uploadSchoolFile(filePath, body, { contentType, upsert: false });
}

function handleUploadParserError(error, res, next) {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ status: 'error', message: 'This image is too large to upload.' });
  }
  return next(error);
}

router.get('/', async (req, res) => {
  try {
    return res.json({ status: 'ok', settings: await getResponseSettings(false) });
  } catch {
    return res.status(503).json({ status: 'error', message: 'Website settings are temporarily unavailable.' });
  }
});

router.get('/admin', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    return res.json({ status: 'ok', settings: await getResponseSettings(true) });
  } catch {
    return res.status(503).json({ status: 'error', message: 'Website settings are temporarily unavailable.' });
  }
});

router.put('/', authMiddleware, roleGuard(['super_admin']), async (req, res) => {
  try {
    const current = await websiteCMS.getWebsiteCMSRecord();
    const settings = validateSettings(req.body?.settings || req.body || {}, current.settings);
    await websiteCMS.publishWebsiteCMSSettings(settings, req.user?.userId);
    return res.json({ status: 'ok', settings: await getResponseSettings(true) });
  } catch (error) {
    const status = Number(error?.status) || 503;
    return res.status(status).json({ status: 'error', message: status === 400 ? error.message : 'Website settings could not be saved.' });
  }
});

router.post('/branding-logo', authMiddleware, roleGuard(['super_admin']), (req, res, next) => {
  rawUploadParser(req, res, (error) => handleUploadParserError(error, res, next));
}, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Choose a logo image before uploading.' });
  }
  if (req.body.length > MAX_LOGO_BYTES) {
    return res.status(413).json({ status: 'error', message: 'This image is too large to upload.' });
  }

  const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const extension = imageExtension(contentType, req.body);
  if (!extension) {
    return res.status(400).json({ status: 'error', message: 'Choose a valid JPEG, PNG, GIF, or WebP logo.' });
  }

  const filePath = `website-branding/${crypto.randomUUID()}.${extension}`;
  try {
    await saveBrandingLogo(filePath, req.body, contentType);
    const url = await getLogoUrl({ logoPath: filePath, logoUrl: DEFAULT_LOGO_URL });
    if (url === DEFAULT_LOGO_URL) {
      return res.status(502).json({ status: 'error', message: 'The logo uploaded, but a preview URL could not be created. The published logo was not changed.' });
    }
    return res.status(201).json({ status: 'ok', path: filePath, url });
  } catch (error) {
    const status = Number(error?.status) || 502;
    return res.status(status).json({ status: 'error', message: status === 503 ? error.message : 'The logo could not be uploaded. The published logo was not changed.' });
  }
});

module.exports = router;