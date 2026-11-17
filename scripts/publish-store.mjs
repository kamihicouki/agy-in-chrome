import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const { CWS_ACCESS_TOKEN, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;
if (!CWS_ACCESS_TOKEN || !/^[A-Za-z0-9_-]+$/.test(CWS_PUBLISHER_ID ?? '') ||
    !/^[a-p]{32}$/.test(CWS_EXTENSION_ID ?? '')) {
  throw new Error('Chrome Web Store token, publisher ID, and extension ID are required.');
}

const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const item = `publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}`;
const base = 'https://chromewebstore.googleapis.com';

async function request(operation, { method = 'GET', body, media = false } = {}) {
  const res = await fetch(`${base}${media ? '/upload' : ''}/v2/${item}:${operation}`, {
    method,
    headers: {
      Authorization: `Bearer ${CWS_ACCESS_TOKEN}`,
      ...(body && { 'Content-Type': media ? 'application/zip' : 'application/json' }),
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await res.json();
  if (!res.ok) {
    throw new Error(`${operation}: HTTP ${res.status} ${result.error?.message ?? ''}`);
  }
  return result;
}

const status = await request('fetchStatus');
if (status.name !== item || status.itemId !== CWS_EXTENSION_ID) {
  throw new Error('Chrome Web Store returned an unexpected item.');
}

if (process.argv.includes('--verify-access')) {
  console.log(`Chrome Web Store access verified for ${status.itemId}.`);
  for (const [label, revision] of [
    ['Published', status.publishedItemRevisionStatus],
    ['Submitted', status.submittedItemRevisionStatus],
  ]) {
    const versions = revision?.distributionChannels?.map(channel => channel.crxVersion) ?? [];
    console.log(`${label}: ${revision?.state ?? 'none'}${versions.length ? ` (${versions.join(', ')})` : ''}`);
  }
  process.exit(0);
}

const published = status.publishedItemRevisionStatus?.distributionChannels ?? [];
const submitted = status.submittedItemRevisionStatus;
if (published.some(channel => channel.crxVersion === version)) {
  console.log(`${version} is already published.`);
  process.exit(0);
}
if (submitted?.state === 'PENDING_REVIEW' || submitted?.state === 'STAGED') {
  if (submitted.distributionChannels?.some(channel => channel.crxVersion === version)) {
    console.log(`${version} was already submitted (${submitted.state}).`);
    process.exit(0);
  }
  throw new Error(`Another revision is ${submitted.state}. Rerun after its review completes.`);
}

const zip = await readFile(`dist/agy-in-chrome-${version}.zip`);
let { uploadState } = await request('upload', { method: 'POST', body: zip, media: true });
for (let poll = 0; uploadState === 'IN_PROGRESS' && poll < 24; poll += 1) {
  await delay(5_000);
  uploadState = (await request('fetchStatus')).lastAsyncUploadState;
}
if (uploadState !== 'SUCCEEDED') throw new Error(`Upload did not succeed: ${uploadState}`);

const result = await request('publish', {
  method: 'POST',
  body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false }),
});
console.log(`Submitted ${version} to the Chrome Web Store: ${result.state ?? 'status not returned'}.`);
