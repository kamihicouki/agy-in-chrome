import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installAttachmentMessaging, sourceHost } from '../attachment.mjs';

test('Add Context reads two origins with all-site access and falls back after revocation', async () => {
  const saved = {};
  const individual = new Set();
  const permissionTabs = [];
  const tab = { id: 3, windowId: 5, url: 'http://one.example/article', title: 'Fixture', active: true };
  const activeWindow = { id: tab.windowId, focused: true };
  let allSitesGranted = false;
  let activeTabGranted = false;
  let captures = 0;
  let listener;
  const history = { addListener() {}, removeListener() {} };
  const canRead = origin => allSitesGranted || individual.has(origin);
  globalThis.chrome = {
    runtime: {
      id: 'fixture-extension',
      getURL: file => 'chrome-extension://fixture-extension/' + file,
      onMessage: { addListener: callback => { listener = callback; } },
    },
    windows: {
      getLastFocused: async () => activeWindow,
      onRemoved: history,
    },
    tabs: {
      query: async () => [tab],
      get: async id => id === tab.id ? tab : null,
      create: async options => {
        permissionTabs.push(options.url);
        return { id: 7 };
      },
      onActivated: history,
      onUpdated: history,
    },
    storage: { session: {
      get: async key => ({ [key]: saved[key] }),
      set: async data => Object.assign(saved, data),
      remove: async key => { delete saved[key]; },
    } },
    permissions: { contains: async ({ permissions, origins }) => Boolean(permissions || origins.every(canRead)) },
    scripting: { executeScript: async ({ files }) => {
      if (!activeTabGranted && !canRead(sourceHost(tab.url))) throw new Error('Cannot access contents of the page');
      if (files) return [{ documentId: 'source' }];
      captures += 1;
      return [{ result: { title: tab.title, url: tab.url, markdown: 'Article body' } }];
    } },
  };
  try {
    installAttachmentMessaging();
    const sender = { id: 'fixture-extension', url: 'https://antigravity.google.com/r/test',
      origin: 'https://antigravity.google.com', documentId: 'panel' };
    const send = message => new Promise(resolve => listener({
      type: 'agy-context', route: sender.url, ...message,
    }, sender, resolve));
    const take = sourceKey => send({ action: 'take', sourceKey, source: 'active', format: 'markdown' });
    const capture = async () => take((await send({ action: 'list' })).sourceKey);
    allSitesGranted = true;
    const pages = ['http://one.example/article', 'https://two.example/article'];
    for (const [index, url] of pages.entries()) {
      tab.url = url;
      const { sourceKey } = await send({ action: 'list' });
      assert.equal(captures, index);
      assert.match((await take(sourceKey)).text, /Article body/);
    }
    assert.equal(permissionTabs.length, 0);
    allSitesGranted = false;
    assert.equal((await capture()).ok, false);
    assert.match(permissionTabs[0], /attachment-settings\.html\?window=5&grant=/);
    activeTabGranted = true;
    assert.equal((await capture()).ok, true);
    activeTabGranted = false;
    individual.add(sourceHost(tab.url));
    assert.equal((await capture()).ok, true);
    assert.equal(permissionTabs.length, 1);
  } finally {
    delete globalThis.chrome;
  }
});
