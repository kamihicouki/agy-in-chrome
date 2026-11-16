import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installAttachmentMessaging, stageContext } from '../attachment.mjs';

test('attachment requests are scoped to the panel document, window and current source', async () => {
  let listener;
  let windowId = 5;
  let active = { id: 1, windowId, url: 'https://example.com/page?private=1', title: 'Fixture', active: true };
  let permission = false;
  let enabled = true;
  let permissionPage;
  const saved = {};
  const changes = new Set();
  const event = {
    addListener: callback => changes.add(callback),
    removeListener: callback => changes.delete(callback),
  };
  let switchDuringCapture = false;
  globalThis.chrome = {
    runtime: {
      id: 'fixture-extension',
      getURL: file => 'chrome-extension://fixture-extension/' + file,
      onMessage: { addListener: callback => { listener = callback; } },
    },
    windows: {
      getLastFocused: async () => ({ id: windowId, focused: true }),
      onRemoved: { addListener() {} },
    },
    tabs: {
      query: async () => [active],
      create: async options => { permissionPage = options; },
      get: async () => active,
      onActivated: event, onUpdated: event,
      captureVisibleTab: async () => {
        if (switchDuringCapture) for (const callback of changes) callback({ windowId, tabId: active.id + 1 });
        return 'data:image/png;base64,dGVzdA==';
      },
    },
    storage: { session: {
      get: async key => ({ [key]: saved[key] }),
      set: async data => Object.assign(saved, data),
      remove: async key => { delete saved[key]; },
    } },
    permissions: { contains: async options => options.permissions ? enabled : permission },
    scripting: { executeScript: async ({ files }) => files
      ? [{ documentId: 'source-1' }]
      : [{ result: { title: 'Fixture', url: active.url, markdown: '**Article body**' } }] },
  };
  try {
    installAttachmentMessaging();
    const sender = { id: 'fixture-extension', origin: 'https://antigravity.google.com',
      url: 'https://antigravity.google.com/r/test', documentId: 'panel-1' };
    const send = (message, from = sender) => new Promise(resolve =>
      listener({ type: 'agy-context', ...message }, from, resolve));
    const take = (sourceKey, source = 'active', format = 'markdown', from = sender) =>
      send({ action: 'take', sourceKey, source, format }, from);

    assert.equal((await send({ action: 'list' }, { ...sender, tab: { id: 7 } })).ok, false);
    let { sourceKey } = await send({ action: 'list' });
    assert.equal((await take(sourceKey)).ok, false);
    assert.match(permissionPage.url, /attachment-settings\.html\?window=5&grant=/);
    permission = true;

    ({ sourceKey } = await send({ action: 'list' }));
    active = { ...active, id: 2 };
    assert.equal((await take(sourceKey)).ok, false);
    ({ sourceKey } = await send({ action: 'list' }));
    assert.equal((await take(sourceKey, 'active', 'markdown', { ...sender, documentId: 'panel-2' })).ok, false);

    ({ sourceKey } = await send({ action: 'list' }));
    const context = await take(sourceKey);
    assert.match(context.text, /\*\*Article body\*\*/);
    assert.doesNotMatch(context.text, /private=1/);
    assert.equal((await take(sourceKey)).ok, false);

    switchDuringCapture = true;
    await assert.rejects(stageContext(active, 'image'), /タブが切り替わりました/);
    assert.equal(changes.size, 0);
    switchDuringCapture = false;
    await stageContext(active, 'image');
    const staged = await send({ action: 'list' });
    assert.equal(staged.stagedImage, true);
    windowId = 6;
    assert.equal((await take(staged.sourceKey, 'staged', 'image')).ok, false);
    windowId = 5;
    ({ sourceKey } = await send({ action: 'list' }));
    assert.equal((await take(sourceKey, 'staged', 'image')).dataUrl, 'data:image/png;base64,dGVzdA==');
    ({ sourceKey } = await send({ action: 'list' }));
    enabled = false;
    assert.equal((await take(sourceKey, 'staged', 'image')).denied, true);
  } finally {
    delete globalThis.chrome;
  }
});
