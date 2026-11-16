import { dashboard, normalizeRemoteLink, remoteLinkKey } from './remote.mjs';

const contextMenuId = 'page-context';

async function configureRemotePanel() {
  const settings = await chrome.storage.local.get(remoteLinkKey);
  await chrome.sidePanel.setOptions({ path: normalizeRemoteLink(settings[remoteLinkKey]) ?? dashboard });
}

chrome.action.onClicked.addListener(async ({ windowId }) => {
  try {
    await Promise.all([chrome.sidePanel.open({ windowId }), configureRemotePanel()]);
  } catch (error) {
    console.error('Could not open Antigravity in the side panel', error);
  }
});

chrome.contextMenus.onClicked.addListener(async ({ menuItemId }, tab) => {
  if (menuItemId !== contextMenuId || tab?.windowId == null) return;
  try {
    await Promise.all([
      chrome.sidePanel.setOptions({ path: 'panel.html' }),
      chrome.sidePanel.open({ windowId: tab.windowId }),
    ]);
  } catch (error) {
    console.error('Could not open page context in the side panel', error);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({ id: contextMenuId, title: 'このページの資料を表示', contexts: ['action'] });
  }).catch(console.error);
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  configureRemotePanel().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  configureRemotePanel().catch(console.error);
});
