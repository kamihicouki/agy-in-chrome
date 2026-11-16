import assert from 'node:assert/strict';
import { test } from 'node:test';
import { panelPin } from '../pins.mjs';

test('the instance start page can be pinned and learns its first conversation', async () => {
  const url = 'https://antigravity.google.com/r/example-v2';
  const origin = 'https://antigravity.static.usercontent.goog';
  const home = { origin, url: origin + '/web/2.32.2/' };
  const tab = { id: 12 };
  const key = 'agy-conversation-pin-12';
  const saved = {};
  globalThis.chrome = { storage: { session: {
    get: async key => ({ [key]: saved[key] }),
    set: async entries => Object.assign(saved, entries),
  } } };
  try {
    const view = { url, fingerprint: 'start' };
    assert.deepEqual((await panelPin(tab, view, home)).route, { url, id: null });
    saved[key] = { url, token: 'tab-marker' };
    const current = { ...view, pinToken: 'tab-marker', rendererUrl: origin + '/web/2.32.2/c/first' };
    await panelPin(tab, current, home, { remember: true });
    assert.equal(saved[key].url, url + '?p=c%2Ffirst');
    assert.equal((await panelPin(tab, { ...view, pinToken: 'tab-marker' }, home)).route.id, null);
    assert.equal(saved[key].url, url + '?p=c%2Ffirst');
    await assert.rejects(panelPin(tab, view, home), /会話に切り替えています/);
    assert.equal((await panelPin(tab, view, home, { recover: true })).pin.token, 'tab-marker');
  } finally {
    delete globalThis.chrome;
  }
});
