import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Storage } from '@google-cloud/storage';

const allowedLicenses = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'Apache-2.0']);
const manifestPath = process.argv[2] || 'noise_catalog/manifest.json';
const bucketName = process.env.GCS_BUCKET;
const databaseUrl = process.env.DATABASE_URL;
if (!bucketName || !databaseUrl) throw new Error('GCS_BUCKET and DATABASE_URL are required.');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('The verified noise catalog is empty.');
const storage = new Storage();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  for (const asset of manifest.assets) {
    if (!allowedLicenses.has(asset.license)) throw new Error(`Noise asset ${asset.key} has disallowed license ${asset.license}.`);
    const localPath = path.resolve(path.dirname(manifestPath), asset.file);
    const bytes = await fs.readFile(localPath);
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    if (checksum !== asset.sha256) throw new Error(`Checksum mismatch for ${asset.key}.`);
    const objectName = `noise-catalog/${checksum}.wav`;
    await storage.bucket(bucketName).file(objectName).save(bytes, { resumable: false, contentType: 'audio/wav', metadata: { cacheControl: 'private, max-age=31536000, immutable' } });
    await client.query(`INSERT INTO noise_assets (key, category, gcs_uri, license, source_url, attribution, checksum, metadata, enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1)
      ON CONFLICT (key) DO UPDATE SET category=excluded.category, gcs_uri=excluded.gcs_uri, license=excluded.license, source_url=excluded.source_url, attribution=excluded.attribution, checksum=excluded.checksum, metadata=excluded.metadata, enabled=1`,
    [asset.key, asset.category, `gs://${bucketName}/${objectName}`, asset.license, asset.sourceUrl, asset.attribution || null, checksum, JSON.stringify({ sampleRate: 16000, channels: 1, provenance: asset.provenance || {} })]);
  }
  console.log(`Uploaded and registered ${manifest.assets.length} verified noise assets.`);
} finally {
  await client.end();
}
