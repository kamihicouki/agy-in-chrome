import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./server.mjs', import.meta.url));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2esAAAAASUVORK5CYII=';
const rpc = (method, id, params) => ({ jsonrpc: '2.0', id, method, params });

test('stdio returns only the fixed fixture contents and rejects path arguments', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-mcp-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const markdownPath = join(dir, 'page.md');
  const pngPath = join(dir, 'page.png');
  const markdown = '# 公開テスト資料\n\nFixture marker.\n';
  writeFileSync(markdownPath, markdown);
  writeFileSync(pngPath, Buffer.from(png, 'base64'));

  const messages = [
    rpc('tools/list', 1),
    rpc('initialize', 2, { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' } }),
    rpc('notifications/initialized'),
    rpc('tools/list', 3),
    rpc('tools/call', 4, { name: 'read_page_context_fixture', arguments: { path: '/unrelated/file.md' } }),
    rpc('tools/call', 5, { name: 'read_page_context_fixture', arguments: {} }),
  ];
  const result = spawnSync(process.execPath, [server, markdownPath, pngPath], {
    input: messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const responses = result.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(responses.map(({ id }) => id), [1, 2, 3, 4, 5]);
  assert.equal(responses[0].error.code, -32000);
  assert.equal(responses[1].result.protocolVersion, '2025-06-18');
  assert.equal(responses[2].result.tools[0].name, 'read_page_context_fixture');
  assert.equal(responses[3].error.code, -32602);
  assert.deepEqual(responses[4].result.content, [
    { type: 'text', text: markdown },
    { type: 'image', mimeType: 'image/png', data: png },
  ]);
});

test('oversized fixture is rejected before a tool can return it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-mcp-large-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const markdownPath = join(dir, 'oversized.md');
  writeFileSync(markdownPath, Buffer.alloc(128 * 1024 + 1));
  const result = spawnSync(process.execPath, [server, markdownPath], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});
