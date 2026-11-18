import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discardAccountAttachments, installAttachmentMessaging, stageContext } from '../attachment.mjs';
import { switchAccountContext } from '../pins.mjs';

test('attachment requests are scoped to the panel document, window and current source', async () => {
  let listener;
  let windowId = 5;
  let windowFocused = true;
  let normalWindows = [5];
  let active = { id: 1, windowId, url: 'https://example.com/page?private=1', title: 'Fixture', active: true };
  let permission = false;
  let enabled = true;
  let activeTabGrant = false;
  let captureError;
  let changeSourceOnCapture = false;
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
      getLastFocused: async () => ({ id: windowId, focused: windowFocused }),
      getAll: async () => normalWindows.map(id => ({ id })),
      onRemoved: { addListener() {} },
    },
    tabs: {
      onRemoved: { addListener() {} },
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
      getKeys: async () => Object.keys(saved),
      get: async key => ({ [key]: saved[key] }),
      set: async data => Object.assign(saved, data),
      remove: async key => { delete saved[key]; },
    } },
    permissions: { contains: async options => options.permissions ? enabled : permission },
    scripting: { executeScript: async ({ files }) => {
      if (captureError) throw new Error(captureError);
      if (!permission && !activeTabGrant) throw new Error('Cannot access contents of the page');
      if (files) return [{ documentId: 'source-1' }];
      const result = { title: 'Fixture', url: active.url, markdown: '**Article body**' };
      if (changeSourceOnCapture) active = { ...active, id: active.id + 1 };
      return [{ result }];
    } },
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
    await send({ action: 'observe', state: 'editor-ready' });
    const footprint = saved['agy-attachment-observation-outer'];
    assert.equal(footprint.status, 'editor-ready');
    assert.deepEqual(Object.keys(footprint).sort(), ['at', 'status']);
    windowFocused = false;
    normalWindows = [5, 6];
    assert.equal((await send({ action: 'list' })).ok, false);
    normalWindows = [5];

    let { sourceKey } = await send({ action: 'list' });
    assert.equal((await take(sourceKey)).ok, false);
    assert.match(permissionPage.url, /attachment-settings\.html\?window=5&grant=/);
    activeTabGrant = true;
    ({ sourceKey } = await send({ action: 'list' }));
    const oneTouch = await take(sourceKey);
    assert.match(oneTouch.text, /\*\*Article body\*\*/);
    const firstOrigin = oneTouch.text.match(/元タブ ID: agy-tab-([a-f0-9]{8})/)[1];
    const firstCapture = oneTouch.text.match(/参照 ID: agy-page-([a-f0-9]{8})/)[1];
    assert.equal(oneTouch.name, `chrome-page-${firstOrigin}-${firstCapture}.md`);
    const sameTab = await take((await send({ action: 'list' })).sourceKey);
    assert.match(sameTab.text, new RegExp('元タブ ID: agy-tab-' + firstOrigin));
    assert.notEqual(sameTab.name, oneTouch.name);
    activeTabGrant = false;
    windowFocused = true;
    permissionPage = undefined;
    captureError = 'Renderer unavailable';
    ({ sourceKey } = await send({ action: 'list' }));
    assert.equal((await take(sourceKey)).ok, false);
    assert.equal(permissionPage, undefined);
    captureError = undefined;
    permission = true;
    changeSourceOnCapture = true;
    ({ sourceKey } = await send({ action: 'list' }));
    assert.equal((await take(sourceKey)).ok, false);
    changeSourceOnCapture = false;

    ({ sourceKey } = await send({ action: 'list' }));
    active = { ...active, id: active.id + 1 };
    assert.equal((await take(sourceKey)).ok, false);
    ({ sourceKey } = await send({ action: 'list' }));
    assert.equal((await take(sourceKey, 'active', 'markdown', { ...sender, documentId: 'panel-2' })).ok, false);

    ({ sourceKey } = await send({ action: 'list' }));
    const context = await take(sourceKey);
    assert.match(context.text, /\*\*Article body\*\*/);
    assert.doesNotMatch(context.text, /private=1/);
    assert.doesNotMatch(context.text, new RegExp('元タブ ID: agy-tab-' + firstOrigin));
    assert.equal((await take(sourceKey)).ok, false);

    await stageContext(active, 'markdown');
    const old = await send({ action: 'list' });
    assert.equal(old.staged, true);
    assert.equal((await take(old.sourceKey, 'staged')).ok, true);
    await switchAccountContext(async () => {
      assert.equal((await send({ action: 'list' })).ok, false);
      await discardAccountAttachments();
    });
    assert.equal((await send({ action: 'verify', sourceKey: old.sourceKey })).ok, false);
    assert.equal((await send({ action: 'list' })).staged, false);

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
