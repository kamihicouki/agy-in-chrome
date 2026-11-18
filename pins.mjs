import { conversationLink, instanceLink } from './remote.mjs';

const pinKey = tabId => 'agy-conversation-pin-' + tabId;
const pinMarker = 'agy-tab-pin';
const sourceEpochs = new Map();
const preparedToggles = new Map();
const rendererRoutes = new Map();
const changing = new Set();
let focusEpoch = 0;
let focusedWindow;

export const sourceEpoch = windowId => focusEpoch + '/' + (sourceEpochs.get(windowId) ?? 0);
let switchingAccount = false;
export const isSwitchingAccount = () => switchingAccount;

export async function switchAccountContext(change) {
  if (switchingAccount || changing.size) {
    throw new Error('会話の切り替えが終わってから、もう一度操作してください。');
  }
  switchingAccount = true;
  focusEpoch++;
  preparedToggles.clear();
  rendererRoutes.clear();
  try {
    await change();
  } finally {
    switchingAccount = false;
  }
}

export async function discardAccountPins() {
  const prefix = pinKey('');
  const keys = (await chrome.storage.session.getKeys()).filter(key => key.startsWith(prefix));
  for (const key of keys) {
    const tabId = Number(key.slice(prefix.length));
    if (!Number.isInteger(tabId) || tabId < 0) continue;
    await navigator.locks.request(key, async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab) await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.storage.session.remove(key);
    });
  }
}

const advance = windowId => sourceEpochs.set(windowId, (sourceEpochs.get(windowId) ?? 0) + 1);
const readPin = async tabId => {
  const key = pinKey(tabId);
  return (await chrome.storage.session.get(key))[key];
};

function pinnedPath(url, token) {
  const target = new URL(url);
  target.hash = pinMarker + '=' + token;
  return target.href;
}

export async function panelPin(tab, view, sender, { remember = false, recover = false } = {}) {
  if (switchingAccount || changing.has(tab?.id)) throw new Error('このタブの会話に切り替えています。');
  const pin = Number.isInteger(tab?.id) ? await readPin(tab.id) : null;
  const recovering = recover && pin && !view?.pinToken && instanceLink(pin.url) === instanceLink(view?.url);
  if (!recovering && (view?.pinToken ?? null) !== (pin?.token ?? null)) {
    throw new Error('このタブの会話に切り替えています。表示を確認してからもう一度操作してください。');
  }
  const explicitRoute = conversationLink(view?.url);
  let renderer = new URL(sender.url);
  if (typeof view?.rendererUrl === 'string' && view.rendererUrl.length <= 2048) {
    const current = new URL(view.rendererUrl);
    if (current.origin === sender.origin) renderer = current;
  }
  const rendererPath = renderer.pathname;
  const renderedId = /^\/web\/[\w.-]+\/c\/([\w-]+)\/?$/.exec(rendererPath)?.[1];
  // A Remote Control renderer can change conversations without rewriting its parent URL.
  // Trust it after the parent and renderer first agree for this outer navigation.
  const identifier = typeof view?.fingerprint === 'string' && view.fingerprint.length <= 2048
    ? view.fingerprint : null;
  const sameOrigin = explicitRoute && sender.origin === new URL(explicitRoute.url).origin;
  const rendererRoute = renderedId ? conversationLink(view?.url, renderedId) : null;
  const instance = instanceLink(view?.url);
  const rendererHome = /^\/web\/[\w.-]+\/?$/.test(rendererPath);
  const home = instance && rendererHome && !explicitRoute ? { url: instance, id: null } : null;
  const route = sameOrigin ? explicitRoute : rendererRoute && (
    !explicitRoute || explicitRoute.id === renderedId ||
    (identifier && rendererRoutes.get(identifier) === view.url) ||
    (pin?.url === rendererRoute.url && tab?.id != null)
  ) ? rendererRoute : home;
  if ((pin || explicitRoute) && !route) {
    throw new Error('公式の会話を読み込んでいます。表示を確認してからもう一度操作してください。');
  }
  if (route && rendererRoute && identifier && Number.isInteger(tab?.id)) {
    rendererRoutes.delete(identifier);
    rendererRoutes.set(identifier, view.url);
    if (rendererRoutes.size > 128) rendererRoutes.delete(rendererRoutes.keys().next().value);
  }
  if (switchingAccount || changing.has(tab?.id)) throw new Error('このタブの会話に切り替えています。');
  if (pin && remember && !recovering && route.id && route.url !== pin.url) {
    await chrome.storage.session.set({ [pinKey(tab.id)]: { ...pin, url: route.url } });
  }
  return { pin, route };
}

export async function togglePin(view, sender) {
  const prepared = preparedToggles.get(view?.documentKey);
  preparedToggles.delete(view?.documentKey);
  if (!prepared) throw new Error('固定の準備ができていません。表示を確認してから押し直してください。');
  if (prepared.expires <= Date.now() || prepared.senderUrl !== sender.url ||
    prepared.viewUrl !== view?.url || prepared.rendererUrl !== view?.rendererUrl ||
    prepared.fingerprint !== view?.fingerprint ||
    prepared.viewPinToken !== view?.pinToken ||
    prepared.epoch !== sourceEpoch(prepared.tab.windowId) || switchingAccount || changing.has(prepared.tab.id)) {
    throw new Error('Chrome タブまたは会話が切り替わりました。表示を確認してから押し直してください。');
  }

  const { tab, pin, route } = prepared;
  changing.add(tab.id);
  const binding = pin ? null : { url: route.url, token: crypto.randomUUID() };
  // Both API calls have to be dispatched while Chrome still has this button's gesture.
  const options = binding
    ? { tabId: tab.id, path: pinnedPath(binding.url, binding.token), enabled: true }
    : { tabId: tab.id, enabled: false };
  try {
    const saved = binding
      ? chrome.storage.session.set({ [pinKey(tab.id)]: binding })
      : chrome.storage.session.remove(pinKey(tab.id));
    const configured = chrome.sidePanel.setOptions(options);
    const opened = chrome.sidePanel.open(binding ? { tabId: tab.id } : { windowId: tab.windowId });
    const results = await Promise.allSettled([saved, configured, opened]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      if (pin) {
        await chrome.storage.session.set({ [pinKey(tab.id)]: pin });
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: pinnedPath(pin.url, pin.token), enabled: true });
      } else {
        await chrome.storage.session.remove(pinKey(tab.id));
        await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
      }
      throw failure.reason;
    }
    return { ok: true, pinned: Boolean(binding) };
  } finally {
    changing.delete(tab.id);
  }
}

export async function rememberPanelPin(tab, view, sender) {
  const epoch = sourceEpoch(tab?.windowId);
  return navigator.locks.request(pinKey(tab?.id), async () => {
    const { pin, route } = await panelPin(tab, view, sender, { remember: true, recover: true });
    if (route && Number.isInteger(tab?.id) && /^[a-f0-9-]{36}$/.test(view?.documentKey) &&
      sourceEpoch(tab.windowId) === epoch) {
      const expires = Date.now() + 3000;
      for (const [documentId, prepared] of preparedToggles) {
        if (prepared.expires <= Date.now()) preparedToggles.delete(documentId);
      }
      preparedToggles.set(view.documentKey, {
        tab, pin, route, expires, epoch, senderUrl: sender.url,
        viewUrl: view.url, rendererUrl: view.rendererUrl, fingerprint: view.fingerprint, viewPinToken: view.pinToken,
      });
    }
    return { ok: true, pinned: Boolean(pin), ready: Boolean(route) };
  });
}

export function installPinTracking(discardStagedContext) {
  chrome.permissions.onRemoved.addListener(() => preparedToggles.clear());
  chrome.windows.onFocusChanged.addListener(windowId => {
    if (windowId < 0) return;
    if (focusedWindow !== windowId) focusEpoch++;
    focusedWindow = windowId;
  });
  chrome.tabs.onActivated.addListener(({ windowId }) => advance(windowId));
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (!change.url && change.status !== 'loading') return;
    if (tab.active) advance(tab.windowId);
    discardStagedContext(tabId, tab.windowId).catch(console.error);
  });
  chrome.tabs.onDetached.addListener((_tabId, { oldWindowId }) => advance(oldWindowId));
  chrome.tabs.onAttached.addListener((_tabId, { newWindowId }) => advance(newWindowId));
  chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
    advance(windowId);
    chrome.storage.session.remove(pinKey(tabId)).catch(console.error);
  });
  chrome.windows.onRemoved.addListener(windowId => sourceEpochs.delete(windowId));
  chrome.sidePanel.onClosed.addListener(({ tabId, path }) => {
    if (switchingAccount || !Number.isInteger(tabId)) return;
    navigator.locks.request(pinKey(tabId), async () => {
      const pin = await readPin(tabId);
      if (!switchingAccount && pin && path !== pinnedPath(pin.url, pin.token)) {
        await chrome.sidePanel.setOptions({ tabId, path: pinnedPath(pin.url, pin.token) });
      }
    }).catch(console.error);
  });
}
