import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const item = `publishers/test-publisher/items/${extensionId}`;

function verifyAccess(response) {
  const fixture = `
    globalThis.fetch = async (url, options) => {
      if (url !== ${JSON.stringify(`https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`)} ||
          options.method !== 'GET' || options.headers.Authorization !== 'Bearer fixture-token') {
        throw new Error('Expected a read-only request for the configured item');
      }
      return Response.json(${JSON.stringify(response)});
    };`;
  return exec(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(fixture)}`,
    'scripts/publish-store.mjs', '--verify-access',
  ], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env,
      CWS_ACCESS_TOKEN: 'fixture-token',
      CWS_PUBLISHER_ID: 'test-publisher',
      CWS_EXTENSION_ID: extensionId,
    },
  });
}

test('connection checks report a pending first submission without uploading', async () => {
  const { stdout } = await verifyAccess({
    name: item,
    itemId: extensionId,
    submittedItemRevisionStatus: {
      state: 'PENDING_REVIEW',
      distributionChannels: [{ crxVersion: '0.7.1' }],
    },
  });
  assert.match(stdout, /Chrome Web Store access verified/);
  assert.match(stdout, /PENDING_REVIEW/);
  assert.match(stdout, /0\.7\.1/);
});

test('connection checks reject a response for a different item', async () => {
  await assert.rejects(verifyAccess({ name: item, itemId: 'wrong-item' }), /unexpected item/);
});
