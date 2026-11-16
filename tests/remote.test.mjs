import assert from 'node:assert/strict';
import { test } from 'node:test';
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
