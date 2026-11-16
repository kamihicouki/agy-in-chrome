import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('bridge fixes workspace and tools, streams replies, and rejects agent permission requests', { timeout: 30_000 }, async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'agy-native-test-'));
  const stub = path.join(cwd, 'agy-fixture');
  await writeFile(stub, `#!${process.execPath}
const readline = require('node:readline');
if (JSON.stringify(process.argv.slice(2)) !== '["acp","--sandbox","--disable-telemetry"]') process.exit(2);
let promptId;
const emit = value => console.log(JSON.stringify({ jsonrpc: '2.0', ...value }));
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') emit({ id: msg.id, result: { protocolVersion: 1 } });
  if (msg.method === 'session/new') {
    if (require('node:fs').realpathSync(msg.params.cwd) !== require("node:fs").realpathSync(process.cwd()) || msg.params.mcpServers.length) process.exit(3);
    emit({ id: msg.id, result: { sessionId: 'fixture-session' } });
  }
  if (msg.method === 'session/prompt') {
    promptId = msg.id;
    if (msg.params.prompt[0].text !== 'fixture prompt') process.exit(4);
    emit({ id: 500, method: 'session/request_permission', params: { sessionId: 'fixture-session' } });
  }
  if (msg.id === 500) {
    if (msg.result?.outcome?.outcome !== 'cancelled') process.exit(5);
    emit({ method: 'session/update', params: { sessionId: 'fixture-session', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fixture response' },
    } } });
    emit({ id: promptId, result: { stopReason: 'end_turn' } });
  }
});
`, { mode: 0o700 });
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../native/host.mjs', import.meta.url)), stub, cwd]);
  const exited = once(bridge, 'exit');
  const frames = [];
  let buffer = Buffer.alloc(0);
  bridge.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE() + 4) {
      const end = buffer.readUInt32LE() + 4;
      frames.push(JSON.parse(buffer.subarray(4, end)));
      buffer = buffer.subarray(end);
    }
  });
  const send = message => {
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    bridge.stdin.write(Buffer.concat([header, body]));
  };
  async function next() {
    for (let count = 0; count < 400; count += 1) {
      if (frames.length) return frames.shift();
      if (bridge.exitCode !== null) throw new Error(`Bridge exited: ${bridge.exitCode}`);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error('Bridge response did not arrive');
  }

  try {
    send({ type: 'connect', token: 1 });
    assert.deepEqual(await next(), { type: 'ready', token: 1 });
    send({ type: 'new', token: 2, cwd: '/', mcpServers: [{ command: 'unexpected' }] });
    assert.deepEqual(await next(), { type: 'session', sessionId: 'fixture-session', token: 2 });
    send({ type: 'prompt', token: 3, sessionId: 'not-owned', text: 'fixture prompt' });
    assert.equal((await next()).type, 'error');
    send({ type: 'prompt', token: 4, sessionId: 'fixture-session', text: 'fixture prompt' });
    assert.deepEqual(await next(), { type: 'permission', sessionId: 'fixture-session' });
    assert.deepEqual(await next(), { type: 'chunk', sessionId: 'fixture-session', text: 'fixture response' });
    assert.deepEqual(await next(), { type: 'done', sessionId: 'fixture-session', token: 4, reason: 'end_turn' });
  } finally {
    bridge.stdin.end();
    await exited;
    await rm(cwd, { recursive: true, force: true });
  }
});
