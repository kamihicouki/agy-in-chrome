import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountRouteKey, dashboard } from '../remote.mjs';

test('the account menu switches the global panel only from the active official account tab', async () => {
  const menuId = 'open-antigravity-account-panel';
  const { contextMenus, action, runtime, windows, tabs, permissions, sidePanel } =
    Object.fromEntries(['contextMenus', 'action', 'runtime', 'windows', 'tabs', 'permissions', 'sidePanel']
      .map(name => [name, {}]));
  const event = { addListener() {} };
  let menuClick;
  contextMenus.onClicked = { addListener: listener => { menuClick = listener; } };
  windows.onRemoved = windows.onFocusChanged = event;
  tabs.onActivated = tabs.onUpdated = tabs.onDetached = tabs.onAttached = tabs.onRemoved = event;
  permissions.onRemoved = runtime.onInstalled = runtime.onStartup = runtime.onMessage = event;
  sidePanel.onClosed = action.onClicked = event;
  action.setBadgeText = action.setTitle = async () => {};

  const routeA = dashboard + 'u/0/';
  const routeB = dashboard + 'u/3/remote';
  let active = { id: 3, windowId: 4, url: routeB, active: true };
  let path = routeA;
  const calls = [];
  tabs.get = async id => id === active.id ? active : { id };
  sidePanel.open = async options => { calls.push(options); };
  sidePanel.getOptions = async () => ({ path });
  sidePanel.setOptions = async options => {
    calls.push(options);
    path = options.path ?? path;
  };
  const state = {
    [accountRouteKey]: routeA,
    'agy-conversation-pin-12': { url: dashboard + 'r/fixture', token: 'previous' },
    'agy-staged-context-4': { text: 'previous account only' },
    other: 'preserved',
  };
  const storage = { session: {
    getKeys: async () => Object.keys(state),
    get: async key => ({ [key]: state[key] }),
    set: async entries => { Object.assign(state, entries); },
    remove: async key => { delete state[key]; },
  } };
  globalThis.chrome = { contextMenus, action, runtime, windows, tabs, permissions, sidePanel, storage };
  try {
    await import('../background.mjs');
    const select = (tab, pageUrl = tab.url) => menuClick({ menuItemId: menuId, pageUrl }, tab);

    await select({ ...active, url: 'https://accounts.google.com/AccountChooser' });
    await select(active, routeA);
    await select({ ...active, active: false });
    assert.deepEqual(calls, []);

    await select(active);
    assert.deepEqual(calls, [{ windowId: 4 }, { tabId: 12, enabled: false }, { path: routeB }]);
    assert.deepEqual(state, { [accountRouteKey]: routeB, other: 'preserved' });

    active = { ...active, url: routeA };
    await select(active);
    assert.equal(path, routeA);
    assert.equal(state[accountRouteKey], routeA);
    await select(active);
    assert.deepEqual(calls.slice(-3), [{ windowId: 4 }, { path: 'panel.html' }, { path: routeA }]);

    const changedTab = { ...active, url: routeB };
    await select(changedTab);
    assert.equal(path, routeA);
    assert.equal(state[accountRouteKey], routeA);
  } finally {
    delete globalThis.chrome;
  }
});
