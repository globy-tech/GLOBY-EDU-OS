const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const SUPABASE_BUCKET = 'school-files';
let supabaseClient = null;
let r2Client = null;

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
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 is not configured. Set CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_BUCKET.');
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
  if (isR2Configured()) {
    const client = getR2Client();
    const { bucket } = getR2Config();
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: filePath,
      Body: file,
      ContentType: options.contentType || 'application/octet-stream',
      ...(options.upsert === true ? {} : { IfNoneMatch: '*' }),
    }));
    return filePath;
  }

  const { error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, file, {
      contentType: options.contentType,
      upsert: options.upsert === true,
    });

  if (error) throw error;
  return filePath;
}

async function createSchoolFileSignedUrl(filePath, expiresIn = 3600) {
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
  createSchoolFileSignedUrl,
  downloadSchoolFile,
};
