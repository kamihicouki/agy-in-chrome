import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { composerPermissions } from '../attachment.mjs';

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
    await bulk.waitFor();
    await page.getByRole('button', { name: 'このサイトだけ許可' }).click();
    await page.getByText(/許可しました。このタブを閉じて/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.requests), [{ origins: ['https://individual.example/*'] }]);
    await page.goto(url + '?window=5&grant=site-token');
    await bulk.waitFor();
    await page.evaluate(() => { window.allowBroadRequest = true; });
    await bulk.click();
    await status.getByText(/一括許可済み。この設定タブを閉じ/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'このサイトだけ許可' }).isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.requests), [{ origins: allOrigins }]);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
