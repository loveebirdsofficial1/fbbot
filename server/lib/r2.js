const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const trim = (v) => (typeof v === 'string' ? v.trim() : '');

const endpoint = trim(process.env.R2_ENDPOINT);
const accessKeyId = trim(process.env.R2_ACCESS_KEY_ID);
const secretAccessKey = trim(process.env.R2_SECRET_ACCESS_KEY);
const bucket = trim(process.env.R2_BUCKET_NAME);

const isR2Configured = Boolean(endpoint && accessKeyId && secretAccessKey && bucket);

const PUBLIC_URL = trim(process.env.R2_PUBLIC_URL);

if (isR2Configured) {
  if (!PUBLIC_URL) {
    console.warn('[r2] R2 configured hai lekin R2_PUBLIC_URL set nahi - public access fail ho sakta hai');
  }
  console.log('[r2] Cloudflare R2 storage enabled');
} else {
  console.warn(
    '[r2] R2 NOT configured (endpoint/accessKey/secret/bucket ki zaroorat hai) - uploads local disk pe honge. Render pe local disk ephemeral hai.'
  );
}

let client = null;

function getR2Client() {
  if (!isR2Configured) return null;
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

async function testR2Connection() {
  if (!isR2Configured) {
    return { ok: false, reason: 'R2 env vars incomplete', configured: false };
  }
  const s3 = getR2Client();
  try {
    await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    return { ok: true, configured: true };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      name: e?.name || 'Error',
      message: e?.message || String(e),
    };
  }
}

function getR2PublicUrl(key) {
  if (PUBLIC_URL) {
    const base = PUBLIC_URL.replace(/\/$/, '');
    return `${base}/${key}`;
  }
  const ep = endpoint.replace(/\/$/, '');
  return `${ep}/${bucket}/${key}`;
}

async function uploadToR2(key, buffer, contentType) {
  const s3 = getR2Client();
  if (!s3) throw new Error('R2 is not configured');

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  return getR2PublicUrl(key);
}

async function deleteFromR2(key) {
  const s3 = getR2Client();
  if (!s3) return false;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    console.error('R2 delete failed:', e.message);
    return false;
  }
}

module.exports = {
  isR2Configured,
  getR2Client,
  testR2Connection,
  getR2PublicUrl,
  uploadToR2,
  deleteFromR2,
};