import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';

const [binary, cwd] = process.argv.slice(2);
const maxFrame = 256 * 1024;
let agent, ready = false, active = null, sequence = 0, buffer = Buffer.alloc(0);
let closing = false;
const pending = new Map();
const sessions = new Set();

function send(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

function write(value) {
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
}

function request(method, params, token, sessionId) {
  const id = ++sequence;
  pending.set(id, { method, token, sessionId });
  write({ id, method, params });
}

function fail(message, token) {
  send({ type: 'error', message, token });
}

function close(message) {
  if (closing) return;
  closing = true;
  fail(message);
  process.stdin.pause();
  agent?.kill();
  process.stdout.end(() => process.exit(0));
}

function onAgentLine(line) {
  let packet;
  try { packet = JSON.parse(line); } catch { return; }
  if (packet === null || typeof packet !== 'object') return;
  if (packet.method && packet.id != null) {
    if (packet.method === 'session/request_permission') {
      write({ id: packet.id, result: { outcome: { outcome: 'cancelled' } } });
      if (active) send({ type: 'permission', sessionId: active });
    } else {
      write({ id: packet.id, error: { code: -32601, message: 'Unsupported client capability' } });
    }
    return;
  }
  if (packet.method === 'session/update' && active && packet.params?.sessionId === active) {
    const update = packet.params.update;
    if (update?.sessionUpdate === 'agent_message_chunk' &&
        update.content?.type === 'text' && typeof update.content.text === 'string') {
      for (let offset = 0; offset < update.content.text.length; offset += 16000) {
        send({ type: 'chunk', sessionId: active, text: update.content.text.slice(offset, offset + 16000) });
      }
    }
    return;
  }
  const entry = pending.get(packet.id);
  if (!entry) return;
  pending.delete(packet.id);
  const { method, token, sessionId } = entry;
  if (method === 'session/prompt') active = null;
  if (packet.error) {
    fail(String(packet.error.message ?? 'ACP request failed').slice(0, 500), token);
    return;
  }
  if (method === 'initialize') {
    if (packet.result?.protocolVersion !== 1) return close('ACP v1 を使用できません。');
    ready = true;
    send({ type: 'ready', token });
  } else if (method === 'session/new') {
    const id = packet.result?.sessionId;
    if (typeof id !== 'string' || !id || id.length > 256) return fail('セッション ID を取得できませんでした。', token);
    sessions.add(id);
    send({ type: 'session', sessionId: id, token });
  } else if (method === 'session/prompt') {
    send({ type: 'done', sessionId, token, reason: packet.result?.stopReason });
  }
}

function onChrome({ type, token, sessionId, text }) {
  if (token !== undefined && (!Number.isSafeInteger(token) || token < 1)) return;
  if (type === 'connect' && !agent) {
    agent = spawn(binary, ['acp', '--sandbox', '--disable-telemetry'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    agent.once('error', () => close('Antigravity CLI を起動できませんでした。'));
    agent.once('exit', () => close('Antigravity CLI との接続が終了しました。'));
    agent.stdin.on('error', () => close('Antigravity CLI との接続が切れました。'));
    createInterface({ input: agent.stdout }).on('line', onAgentLine);
    request('initialize', {
      protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'agy-in-chrome', version: '0.4.0' },
    }, token);
  } else if (!ready) {
    fail('Antigravity CLI に接続してください。', token);
  } else if (type === 'new' && sessions.size < 100 && pending.size < 4) {
    request('session/new', { cwd, mcpServers: [] }, token);
  } else if (type === 'prompt' && !active && sessions.has(sessionId) &&
      typeof text === 'string' && text.trim() && text.length <= 40000) {
    active = sessionId;
    request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, token, sessionId);
  } else if (type === 'cancel' && active && active === sessionId) {
    write({ method: 'session/cancel', params: { sessionId } });
  } else {
    fail('現在の状態ではこの操作を実行できません。', token);
  }
}

if (!binary || !cwd || !isAbsolute(binary) || !isAbsolute(cwd)) close('ローカルの接続設定が不正です。');
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE();
    if (length > maxFrame || length < 2) return close('Chrome からのメッセージサイズが不正です。');
    if (buffer.length < 4 + length) break;
    const body = buffer.subarray(4, 4 + length);
    buffer = buffer.subarray(4 + length);
    let packet;
    try { packet = JSON.parse(body); } catch { return close('Chrome のメッセージを読み取れませんでした。'); }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return close('Chrome のメッセージが不正です。');
    onChrome(packet);
  }
});
process.stdin.once('end', () => { agent?.kill(); process.exit(0); });
process.once('SIGTERM', () => { agent?.kill(); process.exit(0); });
