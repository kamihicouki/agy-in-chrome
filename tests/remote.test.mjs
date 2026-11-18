import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asPrompt, captureTabContext } from '../context.mjs';
import { dashboard, normalizeAccountRoute, normalizeRemoteLink, openRemote, preferredRemotePanel, accountRouteKey } from '../remote.mjs';

test('Remote Control accepts only the documented device and conversation links', () => {
  const base = dashboard + 'r/example-id-v2';
  assert.equal(normalizeRemoteLink(' ' + base + '/ '), base);
  for (const path of ['?p=c/conversation-id', '?p=c%2fconversation-id']) {
    assert.equal(normalizeRemoteLink(base + path), base + '?p=c%2Fconversation-id');
  }
  for (const invalid of [
    'http://antigravity.google.com/r/id', 'https://antigravity.google.com.evil.test/r/id',
    'https://antigravity.google.com@evil.test/r/id', 'https://user@antigravity.google.com/r/id',
    dashboard, base + '#private', base + '?p=c%2Fa&p=c%2Fb', base + '?redirect=https://evil.test',
    dashboard + 'r/..', base + '?p=c%2F..', base + '?p=c%252Fid',
  ]) assert.equal(normalizeRemoteLink(invalid), null, invalid);
});

test('account handoff accepts only exact HTTPS Antigravity account dashboard routes', () => {
  assert.equal(normalizeAccountRoute(dashboard + 'u/3/remote'), dashboard + 'u/3/remote');
  for (const path of ['u/3/', 'u/3/r/id', 'u/3/remote?redirect=https://example.org',
    'u/3/remote#draft', 'u/-1/remote', 'u/03/remote', 'u/3/../3/remote']) {
    assert.equal(normalizeAccountRoute(dashboard + path), null, path);
  }
  assert.equal(normalizeAccountRoute('https://antigravity.google.com.example.org/u/3/remote'), null);
  assert.equal(normalizeAccountRoute('https://login@antigravity.google.com/u/3/remote'), null);
});

test('the explicit account route takes precedence until the browser session ends', async () => {
  let session = { [accountRouteKey]: dashboard + 'u/3/remote' };
  const chrome = { storage: {
    session: { get: async () => session },
    local: { get: async () => ({ remoteControlLink: dashboard + 'r/previous' }) },
  } };
  assert.equal(await preferredRemotePanel(chrome), dashboard + 'u/3/remote');
  session = {};
  assert.equal(await preferredRemotePanel(chrome), dashboard + 'r/previous');
});

test('a rejected split opens a normal tab without invoking the local bridge', async () => {
  const calls = [];
  const chrome = { tabs: {
    createSplit() {},
    query: async () => [{ id: 7, splitViewId: -1, pinned: true }],
    create: async values => {
      calls.push(values);
      if (values.splitWithTabId) throw new Error('split unavailable');
    },
  } };
  await openRemote(chrome, dashboard, 'split', 5);
  assert.deepEqual(calls, [
    { url: dashboard, windowId: 5, splitWithTabId: 7, pinned: true },
    { url: dashboard, windowId: 5 },
  ]);
});

test('the remote viewer is reused without navigating its current conversation', async () => {
  const session = {};
  const calls = [];
  const chrome = {
    storage: { session: {
      get: async key => ({ [key]: session[key] }),
      set: async values => Object.assign(session, values),
    } },
    windows: {
      get: async id => id === 2
        ? { state: 'normal', left: 0, top: 30, width: 1200, height: 800 }
        : { id, type: 'popup', tabs: [{ id: 9 }] },
      create: async options => {
        calls.push(options);
        return { id: 3, tabs: [{ id: 9 }] };
      },
      update: async (id, values) => { calls.push([id, values]); },
    },
    tabs: { update: async (id, values) => { calls.push([id, values]); } },
  };
  const screen = { availLeft: 0, availWidth: 1400 };
  await openRemote(chrome, dashboard, 'window', 2, { screen });
  await openRemote(chrome, dashboard, 'window', 2, { screen });
  await openRemote(chrome, dashboard, 'window', 2, { screen, reset: true });

  assert.deepEqual(calls, [
    { url: dashboard, type: 'popup', width: 440, left: 960, top: 30, height: 800 },
    [2, { width: 960 }],
    [3, { focused: true }],
    [9, { url: dashboard, active: true }],
    [3, { focused: true }],
  ]);
});


test('page context marks a shortened URL and quotes every line', () => {
  const text = asPrompt({
    title: 'Example', url: 'https://example.com/', shortenedUrl: true,
    selected: 'first line\nsecond line',
  });
  assert.match(text, /URL（認証情報・クエリ・フラグメントを省略）: https:\/\/example.com\//);
  assert.match(text, /> first line\n> second line$/);
});

test('capturing context removes URL secrets and stops when the source changes', async () => {
  const tab = { id: 7, url: 'https://example.com/page?secret=private#private' };
  let current = { ...tab, active: true };
  const chrome = {
    scripting: { executeScript: async ({ target, args }) => {
      assert.deepEqual(target, { tabId: 7 });
      assert.deepEqual(args, [true]);
      return [{ documentId: 'original', result: { title: 'Example', url: tab.url, viewport: 'Visible text' } }];
    } },
    tabs: { get: async () => current },
  };
  const { text, documentId } = await captureTabContext(chrome, tab, true);
  assert.equal(documentId, 'original');
  assert.match(text, /https:\/\/example.com\/page\n/);
  assert.match(text, /> Visible text$/);
  assert.doesNotMatch(text, /secret|private/);

  current = { ...current, active: false };
  await assert.rejects(captureTabContext(chrome, tab, true), /Source page changed/);
  assert.equal(await captureTabContext(chrome, { id: 3, url: dashboard }, true), null);
});
