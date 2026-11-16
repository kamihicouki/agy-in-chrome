import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { composerPermissions, installAttachmentMessaging, sourceHost } from '../attachment.mjs';

const allOrigins = ['http://*/*', 'https://*/*'];

test('setup requests the official and all-site permissions separately and reflects revocation', async () => {
  const server = createServer(async (request, response) => {
    const asset = new URL(request.url, 'http://localhost').pathname.slice(1);
    if (!['attachment-settings.html', 'panel.css'].includes(asset) && !/^[a-z-]+\.mjs$/.test(asset)) {
      response.writeHead(404).end();
      return;
    }
    const type = asset.endsWith('.html') ? 'text/html' : asset.endsWith('.css') ? 'text/css' : 'text/javascript';
    try {
      const body = await readFile(new URL('../' + asset, import.meta.url));
      response.setHeader('Content-Type', type + ';charset=utf-8');
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
    const page = await browser.newPage();
    await page.addInitScript(allOrigins => {
      let officialAllowed = false;
      let allAllowed = false;
      let registered = [];
      const added = new Set();
      const removed = new Set();
      window.requests = [];
      window.allowBroadRequest = false;
      window.revokeBroad = () => {
        allAllowed = false;
        for (const notify of removed) notify();
      };
      chrome.permissions = {
        contains: async ({ permissions, origins }) => (!permissions || officialAllowed) &&
          (!origins || origins.every(host => allOrigins.includes(host) ? allAllowed : officialAllowed)),
        request: async permissions => {
          window.requests.push(permissions);
          if (permissions.origins.includes(allOrigins[0])) {
            if (!window.allowBroadRequest) return false;
            allAllowed = true;
          } else {
            officialAllowed = true;
          }
          for (const notify of added) notify();
          return true;
        },
        onAdded: { addListener: listener => added.add(listener) },
        onRemoved: { addListener: listener => removed.add(listener) },
      };
      chrome.scripting = {
        getRegisteredContentScripts: async () => registered,
        registerContentScripts: async scripts => { registered = scripts; },
      };
      const grantKey = 'agy-site-grant-5';
      chrome.storage = {
        session: {
          get: async () => ({ [grantKey]: {
            host: 'https://individual.example/*', grant: 'site-token', expires: Date.now() + 60_000,
          } }),
          remove: async () => {},
        },
      };
    }, allOrigins);
    const url = 'http://127.0.0.1:' + server.address().port + '/attachment-settings.html';
    await page.goto(url);
    const specific = page.getByRole('button', { name: 'Chrome で許可' });
    const bulk = page.getByRole('button', { name: '全 HTTP・HTTPS サイトを許可' });
    await specific.waitFor();
    assert.equal(await bulk.isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.requests), []);
    await specific.click();
    await bulk.waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests), [composerPermissions]);
    await bulk.evaluate(button => button.click());
    assert.deepEqual(await page.evaluate(() => window.requests), [composerPermissions]);
    await bulk.press('Enter');
    const status = page.locator('#all-sites-status');
    await status.getByText(/一括許可を見送りました/).waitFor();
    assert.equal(await bulk.isVisible(), true);
    await page.evaluate(() => { window.allowBroadRequest = true; });
    await bulk.click();
    await status.getByText(/一括許可済み/).waitFor();
    assert.equal(await bulk.isVisible(), false);
    await page.evaluate(() => window.revokeBroad());
    await bulk.waitFor();
    assert.equal(await specific.isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.requests), [
      composerPermissions, { origins: allOrigins }, { origins: allOrigins },
    ]);

    await page.goto(url + '?window=5&grant=site-token');
    await specific.click();
    await page.getByText(/許可しました。このタブを閉じて/).waitFor();
    assert.equal(await bulk.isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.requests), [{ origins: ['https://individual.example/*'] }]);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

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
