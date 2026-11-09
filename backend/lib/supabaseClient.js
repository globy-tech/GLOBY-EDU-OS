const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs/promises');
const path = require('path');
const { isProductionRuntime } = require('../config/app-url.config');

const SUPABASE_BUCKET = 'school-files';
let supabaseClient = null;
let r2Client = null;

function getLocalQaFilePath(filePath) {
  if (isProductionRuntime() || String(process.env.GLOBY_QA_MODE || '').trim().toLowerCase() !== 'true') return null;
  const qaHome = String(process.env.GLOBY_QA_HOME || '').trim();
  if (!qaHome) throw new Error('Isolated QA file storage requires GLOBY_QA_HOME.');

  const segments = String(filePath || '').replace(/\\/g, '/').split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Invalid isolated QA file path.');
  }

  const root = path.resolve(qaHome, 'files');
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Invalid isolated QA file path.');
  }
  return resolved;
}

function getFileContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  })[extension] || 'application/octet-stream';
}

function getSupabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || '').trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  };
}

function getR2Config() {
  return {
    accountId: String(process.env.CLOUDFLARE_R2_ACCOUNT_ID || '').trim(),
    accessKeyId: String(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: String(process.env.CLOUDFLARE_R2_BUCKET || '').trim(),
    endpoint: String(process.env.CLOUDFLARE_R2_ENDPOINT || '').trim(),
    publicUrl: String(process.env.CLOUDFLARE_R2_PUBLIC_URL || '').trim(),
  };
}

function isR2PublicUrlConfigured() {
  const { endpoint, publicUrl } = getR2Config();
  if (!publicUrl || /[<>]|<[^>]+>|placeholder|your[-_ ]/i.test(publicUrl)) return false;

  try {
    const publicUrlParts = new URL(publicUrl);
    const endpointParts = new URL(endpoint);
    const publicHostname = publicUrlParts.hostname.toLowerCase();
    return publicUrlParts.protocol === 'https:' &&
      !publicUrlParts.username &&
      !publicUrlParts.password &&
      !publicUrlParts.search &&
      !publicUrlParts.hash &&
      publicHostname !== endpointParts.hostname.toLowerCase() &&
      !publicHostname.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}

function getR2ConfigurationStatus() {
  const { accountId, endpoint, accessKeyId, secretAccessKey, bucket } = getR2Config();
  const missingVariables = [];
  if (!accountId) missingVariables.push('CLOUDFLARE_R2_ACCOUNT_ID');
  if (!endpoint) missingVariables.push('CLOUDFLARE_R2_ENDPOINT');
  if (!accessKeyId) missingVariables.push('CLOUDFLARE_R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missingVariables.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  if (!bucket) missingVariables.push('CLOUDFLARE_R2_BUCKET');

  const endpointMatchesAccount = !accountId || !endpoint || endpoint === `https://${accountId}.r2.cloudflarestorage.com`;
  const invalidVariables = endpointMatchesAccount ? [] : ['CLOUDFLARE_R2_ENDPOINT'];
  return {
    configured: missingVariables.length === 0 && invalidVariables.length === 0,
    missingVariables,
    invalidVariables,
  };
}

function isR2Configured() {
  return getR2ConfigurationStatus().configured;
}

function getSchoolFilePublicUrl(filePath) {
  const { publicUrl } = getR2Config();
  if (!isR2PublicUrlConfigured() || !isR2Configured()) return null;
  const encodedPath = String(filePath || '').split('/').map(encodeURIComponent).join('/');
  return `${publicUrl.replace(/\/$/, '')}/${encodedPath}`;
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.');
  }

  supabaseClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

function getR2Client() {
  if (r2Client) return r2Client;

  const { endpoint, accessKeyId, secretAccessKey } = getR2Config();
  const status = getR2ConfigurationStatus();
  if (!status.configured) {
    const issues = [
      ...status.missingVariables.map((variable) => `missing ${variable}`),
      ...status.invalidVariables.map((variable) => `invalid ${variable}`),
    ];
    throw new Error(`Cloudflare R2 configuration is unavailable: ${issues.join(', ')}.`);
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  return r2Client;
}

async function uploadSchoolFile(filePath, file, options = {}) {
  const localQaPath = getLocalQaFilePath(filePath);
  if (localQaPath) {
    await fs.mkdir(path.dirname(localQaPath), { recursive: true });
    await fs.writeFile(localQaPath, file, { flag: options.upsert === true ? 'w' : 'wx' });
    if (options.returnMetadata === true) {
      const metadata = await fs.stat(localQaPath);
      return { filePath, storage: 'local-qa', size: metadata.size, mtimeMs: metadata.mtimeMs, ino: metadata.ino };
    }
    return filePath;
  }

  if (isR2Configured()) {
    const client = getR2Client();
    const { bucket } = getR2Config();
    const result = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: filePath,
      Body: file,
      ContentType: options.contentType || 'application/octet-stream',
      ...(options.upsert === true ? {} : { IfNoneMatch: '*' }),
    }));
    if (options.returnMetadata === true) {
      return {
        filePath,
        storage: 'r2',
        eTag: result.ETag,
        versionId: result.VersionId,
      };
    }
    return filePath;
  }

  const { data, error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, file, {
      contentType: options.contentType,
      upsert: options.upsert === true,
    });

  if (error) throw error;
  if (options.returnMetadata === true) return { filePath, storage: 'supabase', objectId: data?.id };
  return filePath;
}

async function deleteSchoolFile(filePath, metadata = {}) {
  const localQaPath = getLocalQaFilePath(filePath);
  if (localQaPath) {
    if (metadata.storage !== 'local-qa') throw new Error('Cannot safely remove the isolated QA upload without its creation metadata.');
    const current = await fs.stat(localQaPath);
    if (current.size !== metadata.size || current.mtimeMs !== metadata.mtimeMs || current.ino !== metadata.ino) {
      throw new Error('The isolated QA upload changed after it was created and was not removed.');
    }
    await fs.unlink(localQaPath);
    return true;
  }

  if (metadata.storage === 'r2') {
    if (!metadata.eTag && !metadata.versionId) {
      throw new Error('Cannot safely remove the R2 upload without its object ETag or version ID.');
    }
    const { bucket } = getR2Config();
    await getR2Client().send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: filePath,
      ...(metadata.eTag ? { IfMatch: metadata.eTag } : {}),
      ...(metadata.versionId ? { VersionId: metadata.versionId } : {}),
    }));
    return true;
  }

  throw new Error('The active storage provider does not support a safe conditional upload cleanup.');
}

async function createSchoolFileSignedUrl(filePath, expiresIn = 3600) {
  const localQaPath = getLocalQaFilePath(filePath);
  if (localQaPath) {
    const contents = await fs.readFile(localQaPath);
    return `data:${getFileContentType(filePath)};base64,${contents.toString('base64')}`;
  }

  if (isR2Configured()) {
    const client = getR2Client();
    const { bucket } = getR2Config();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: filePath,
    });
    return getSignedUrl(client, command, { expiresIn: Math.max(300, Number(expiresIn) || 3600) });
  }

  const { data, error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(filePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

async function downloadSchoolFile(filePath) {
  const localQaPath = getLocalQaFilePath(filePath);
  if (localQaPath) return fs.readFile(localQaPath);

  if (isR2Configured()) {
    const client = getR2Client();
    const { bucket } = getR2Config();
    return client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: filePath,
    }));
  }

  const { data, error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_BUCKET)
    .download(filePath);

  if (error) throw error;
  return data;
}

module.exports = {
  SUPABASE_BUCKET,
  getSupabaseClient,
  getR2Client,
  isR2Configured,
  getR2ConfigurationStatus,
  isR2PublicUrlConfigured,
  getSchoolFilePublicUrl,
  getR2Config,
  uploadSchoolFile,
  deleteSchoolFile,
  createSchoolFileSignedUrl,
  downloadSchoolFile,
};
