export const dashboard = 'https://antigravity.google.com/';
export const remoteLinkKey = 'remoteControlLink';

export function normalizeRemoteLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const match = /^https:\/\/antigravity\.google\.com\/r\/([\w-]+)\/?(?:\?p=(c(?:\/|%2[fF])[\w-]+))?$/.exec(value.trim());
  if (!match) return null;
  const target = new URL(`r/${match[1]}`, dashboard);
  if (match[2]) target.searchParams.set('p', decodeURIComponent(match[2]));
  return target.href;
}

export async function openRemote(chrome, url, mode, windowId) {
  if (mode === 'window') {
    await chrome.windows.create({ url, type: 'popup', width: 480 });
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
