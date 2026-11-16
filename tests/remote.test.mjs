import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asPrompt } from '../context.mjs';
import { dashboard, normalizeRemoteLink, openRemote } from '../remote.mjs';

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
