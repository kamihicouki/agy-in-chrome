export const dashboard = 'https://antigravity.google.com/';
export const accountRouteKey = 'agy-account-panel-route';
export const accountPanelLock = 'agy-account-panel';
export const remoteLinkKey = 'remoteControlLink';
const viewKey = 'remoteControlView';

export function normalizeAccountRoute(value) {
  return typeof value === 'string' && value.startsWith(dashboard) &&
    /^u\/(?:0|[1-9][0-9]{0,8})\/(?:remote)?$/.test(value.slice(dashboard.length)) &&
    !/\s/.test(value) ? value : null;
}

export async function preferredRemotePanel(chrome) {
  const session = await chrome.storage.session.get(accountRouteKey);
  const account = normalizeAccountRoute(session[accountRouteKey]);
  if (account) return account;
  const saved = await chrome.storage.local.get(remoteLinkKey);
  return normalizeRemoteLink(saved[remoteLinkKey]) ?? dashboard;
}

export function normalizeRemoteLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const match = /^https:\/\/antigravity\.google\.com\/r\/([\w-]+)\/?(?:\?p=(c(?:\/|%2[fF])[\w-]+))?$/.exec(value.trim());
  if (!match) return null;
  const target = new URL(`r/${match[1]}`, dashboard);
  if (match[2]) target.searchParams.set('p', decodeURIComponent(match[2]));
  return target.href;
}

export function instanceLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let route;
  try { route = new URL(value); } catch { return null; }
  if (route.origin !== new URL(dashboard).origin || route.username || route.password ||
    !/^\/(?:u\/(?:0|[1-9][0-9]{0,8})\/)?r\/[\w-]+\/?$/.test(route.pathname) || route.searchParams.getAll('p').length > 1) return null;
  return new URL(route.pathname.replace(/\/$/, ''), dashboard).href;
}

export function conversationLink(value, rendererId) {
  const instance = instanceLink(value);
  if (!instance) return null;
  const id = rendererId === undefined
    ? /^c\/([\w-]+)(?:\?.*)?$/.exec(new URL(value).searchParams.get('p'))?.[1]
    : /^[\w-]+$/.test(rendererId) ? rendererId : null;
  if (!id) return null;
  const target = new URL(instance);
  target.searchParams.set('p', 'c/' + id);
  return { url: target.href, id };
}

export async function openRemote(chrome, url, mode, windowId, { reset, screen } = {}) {
  if (mode === 'window') {
    await openViewer(chrome, url, windowId, reset, screen);
    return;
  }

  if (mode === 'split' && typeof chrome.tabs.createSplit === 'function') {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id != null && tab.splitViewId === -1) {
      try {
        await chrome.tabs.create({ url, windowId, splitWithTabId: tab.id, pinned: tab.pinned });
        return;
      } catch {
        // The source tab may have closed or become ineligible.
      }
    }
  }
  await chrome.tabs.create({ url, windowId });
}

async function openViewer(chrome, url, sourceWindowId, reset, screen) {
  const { [viewKey]: saved } = await chrome.storage.session.get(viewKey);
  const existing = saved && await chrome.windows.get(saved.windowId, { populate: true }).catch(() => null);
  if (existing?.type === 'popup' && existing.tabs?.some(tab => tab.id === saved.tabId)) {
    if (reset || saved.target !== url) {
      await chrome.tabs.update(saved.tabId, { url, active: true });
      await chrome.storage.session.set({ [viewKey]: { ...saved, target: url } });
    }
    await chrome.windows.update(existing.id, existing.state === 'minimized'
      ? { focused: true, state: 'normal' } : { focused: true });
    return;
  }

  const source = await chrome.windows.get(sourceWindowId);
  const width = 440;
  const screenRight = screen?.availLeft + screen?.availWidth;
  const sourceRight = source.left + source.width;
  const viewerLeft = Math.min(sourceRight, screenRight - width);
  const sourceWidth = viewerLeft - source.left;
  const fitsAlongside = source.state === 'normal' && source.left >= screen?.availLeft &&
    sourceRight <= screenRight && sourceWidth >= 520;
  const defaults = { url, type: 'popup', width };
  let positioned = false;
  let viewer;
  if (fitsAlongside) {
    viewer = await chrome.windows.create({
      ...defaults, left: viewerLeft, top: source.top, height: source.height,
    }).catch(() => null);
    positioned = viewer != null;
  }
  if (!viewer) viewer = await chrome.windows.create(defaults);
  if (viewer?.id == null) throw new Error('Remote Control window did not open');
  const [tab] = viewer.tabs ?? await chrome.tabs.query({ windowId: viewer.id });
  if (tab?.id != null) {
    await chrome.storage.session.set({ [viewKey]: { windowId: viewer.id, tabId: tab.id, target: url } });
  }
  if (positioned && sourceWidth < source.width) {
    await chrome.windows.update(sourceWindowId, { width: sourceWidth }).catch(() => {});
  }
}
