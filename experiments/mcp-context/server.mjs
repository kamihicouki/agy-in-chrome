import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { createInterface } from 'node:readline';

const supportedVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const tool = {
  name: 'read_page_context_fixture',
  description: 'Read the test Markdown and optional screenshot supplied when this local server was launched.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function readFixture(path, maxBytes, extension) {
  if (!path?.toLowerCase().endsWith(extension)) throw new Error('Invalid fixture extension');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw new Error('Invalid fixture size or type');
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length);
      if (!count) break;
      length += count;
    }
    if (length !== stat.size) throw new Error('Fixture changed while loading');
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

function loadFixtures([markdownPath, pngPath, ...extra]) {
  if (!markdownPath || extra.length) throw new Error('Invalid fixture arguments');
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(readFixture(markdownPath, 128 * 1024, '.md'));
  if (!markdown.trim()) throw new Error('Empty Markdown fixture');

  const content = [{ type: 'text', text: markdown }];
  if (pngPath) {
    const image = readFixture(pngPath, 4 * 1024 * 1024, '.png');
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (image.length < 33 || !image.subarray(0, 8).equals(pngSignature) ||
        image.readUInt32BE(8) !== 13 || image.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('Invalid PNG header');
    }
    content.push({ type: 'image', mimeType: 'image/png', data: image.toString('base64') });
  }
  return content;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serve(content) {
  let initialized = false;
  let ready = false;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (id, value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...value }) + '\n');
  const error = (id, code, message) => send(id, { error: { code, message } });

  lines.on('line', (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      error(null, -32700, 'Parse error');
      return;
    }
    if (!object(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      error(null, -32600, 'Invalid request');
      return;
    }

    const { id, method, params } = request;
    if (id === undefined) {
      if (method === 'notifications/initialized' && initialized) ready = true;
      return;
    }
    if (typeof id !== 'string' && !Number.isInteger(id)) {
      error(null, -32600, 'Invalid request ID');
      return;
    }

    if (method === 'ping') {
      send(id, { result: {} });
    } else if (method === 'initialize') {
      if (initialized || typeof params?.protocolVersion !== 'string') {
        error(id, -32602, 'Invalid initialization');
        return;
      }
      initialized = true;
      const protocolVersion = supportedVersions.includes(params.protocolVersion)
        ? params.protocolVersion : supportedVersions[0];
      send(id, {
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'agy-page-context-experiment', version: '0.1.0' },
        },
      });
    } else if (!ready) {
      error(id, -32000, 'Initialize the server before calling tools');
    } else if (method === 'tools/list') {
      send(id, { result: { tools: [tool] } });
    } else if (method === 'tools/call') {
      const args = params?.arguments;
      if (params?.name !== tool.name || (args !== undefined && (!object(args) || Object.keys(args).length))) {
        error(id, -32602, 'Call read_page_context_fixture with no arguments');
        return;
      }
      send(id, { result: { content } });
    } else {
      error(id, -32601, 'Method not found');
    }
  });
}

try {
  serve(loadFixtures(process.argv.slice(2)));
} catch {
  console.error('Usage: node server.mjs <UTF-8 Markdown fixture, up to 128 KiB> [PNG fixture, up to 4 MiB]');
  process.exitCode = 1;
}
