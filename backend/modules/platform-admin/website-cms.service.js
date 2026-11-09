const fs = require('fs/promises');
const path = require('path');
const firebaseCore = require('../../firebase.core');

const WEBSITE_CMS_DOCUMENT_ID = 'website-cms';
const DEFAULT_WEBSITE_CMS = Object.freeze({
  companyName: 'GlobyEdu OS',
  logoUrl: '/src/assets/images/ui/globyedu-logo.jpg',
  logoPath: '',
  heroTitle: 'The premium operating system for modern schools.',
  heroSubtitle: 'Unify admissions, attendance, lesson planning, finance, messaging, and reporting in one elegant school operations experience built for growth.',
  contactEmail: 'hello@globyedu.com',
  contactPhone: '+233 53 749 7607',
  address: '',
  businessHours: 'Monday-Friday • 8am to 6pm',
  website: 'https://globyedu.com',
  whatsApp: '+233 53 749 7607',
  googleMapsUrl: 'https://maps.google.com',
  themeColor: '#0ea5e9',
  socialLinks: 'LinkedIn, Twitter, Facebook, Instagram',
});

const STRING_FIELD_LIMITS = Object.freeze({
  companyName: 120,
  logoUrl: 2048,
  logoPath: 240,
  heroTitle: 240,
  heroSubtitle: 1000,
  contactEmail: 254,
  contactPhone: 80,
  address: 300,
  businessHours: 160,
  website: 2048,
  whatsApp: 80,
  googleMapsUrl: 2048,
  themeColor: 7,
  socialLinks: 500,
});

function getLocalSettingsPath() {
  const configuredPath = String(process.env.GLOBY_WEBSITE_CMS_FILE || '').trim();
  if (configuredPath) return path.resolve(configuredPath);

  if (String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() === 'true') {
    const qaHome = String(process.env.GLOBY_QA_HOME || '').trim();
    if (!qaHome) throw new Error('Isolated QA CMS storage requires GLOBY_QA_HOME.');
    return path.resolve(qaHome, 'website-cms.json');
  }

  return path.resolve(__dirname, '../../data/website-cms.json');
}

function pickWebsiteCMSSettings(input = {}, base = DEFAULT_WEBSITE_CMS) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const settings = {};
  for (const [field, limit] of Object.entries(STRING_FIELD_LIMITS)) {
    const value = Object.prototype.hasOwnProperty.call(source, field) ? source[field] : base[field];
    settings[field] = String(value ?? '').trim().slice(0, limit);
  }
  return settings;
}

async function readLocalSettings() {
  const filePath = getLocalSettingsPath();
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeLocalSettings(record) {
  const filePath = getLocalSettingsPath();
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${require('crypto').randomUUID()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function getWebsiteCMSRecord() {
  const record = firebaseCore.isFirebaseCoreMode()
    ? await firebaseCore.getById('platformSettings', WEBSITE_CMS_DOCUMENT_ID)
    : await readLocalSettings();
  if (!record || record.published !== true) {
    return { published: false, settings: { ...DEFAULT_WEBSITE_CMS } };
  }
  return {
    published: true,
    settings: pickWebsiteCMSSettings(record.settings),
  };
}

async function publishWebsiteCMSSettings(settings, updatedBy) {
  const record = {
    published: true,
    settings: pickWebsiteCMSSettings(settings),
    updatedBy: String(updatedBy || '').slice(0, 200),
    updatedAt: new Date().toISOString(),
  };

  if (firebaseCore.isFirebaseCoreMode()) {
    return firebaseCore.saveById('platformSettings', WEBSITE_CMS_DOCUMENT_ID, record, false);
  }

  await writeLocalSettings(record);
  return record;
}

module.exports = {
  DEFAULT_WEBSITE_CMS,
  WEBSITE_CMS_DOCUMENT_ID,
  getWebsiteCMSRecord,
  pickWebsiteCMSSettings,
  publishWebsiteCMSSettings,
};