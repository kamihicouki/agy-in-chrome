import { attachmentObservationPrefix, attachmentSetupMenu, discardAccountAttachments, discardStagedContext, installAttachmentMessaging, registerComposer, stageContext, stageImageMenu, stageMarkdownMenu } from './attachment.mjs';
import { captureTabContext, downloadContextFile } from './context.mjs';
import { accountPanelLock, accountRouteKey, normalizeAccountRoute, preferredRemotePanel } from './remote.mjs';
import { discardAccountPins, installPinTracking, switchAccountContext } from './pins.mjs';

installAttachmentMessaging();
installPinTracking(discardStagedContext);

const accountMenuId = 'open-antigravity-account-panel';
const contextMenuId = 'page-context';
const copySelectionId = 'copy-antigravity-selection';
const copyViewportId = 'copy-antigravity-viewport';
const saveFileId = 'save-antigravity-file';

async function copyPageContext(tab, includeViewport) {
  let copied = false;
  try {
    const context = await captureTabContext(chrome, tab, includeViewport);
    if (context) {
      await navigator.clipboard.writeText(context.text);
      copied = true;
    }
  } catch {
    // The source may have navigated, closed, or disallowed script injection.
  }
  const tabId = tab.id;
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: copied ? '✓' : '!' }),
    chrome.action.setTitle({ tabId, title: copied
      ? '資料をコピーしました。公式 Antigravity の入力欄に貼り付けてください。'
      : '資料をコピーできませんでした。' }),
  ]);
}


async function savePageContext(tab) {
  try {
    const context = await captureTabContext(chrome, tab, true);
    if (!context?.documentId) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [context.documentId] },
      func: downloadContextFile, args: [context.text],
    });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
  }
}

async function configureRemotePanel() {
  await navigator.locks.request(accountPanelLock, async () => {
    const path = await preferredRemotePanel(chrome);
    if ((await chrome.sidePanel.getOptions({})).path !== path) await chrome.sidePanel.setOptions({ path });
  });
}

chrome.action.onClicked.addListener(({ id: tabId, windowId }) => {
  // A tab-specific panel previously disabled at unpin can still use the global panel.
  void Promise.any([chrome.sidePanel.open({ windowId }), chrome.sidePanel.open({ tabId })]).catch(console.error);
  void configureRemotePanel().catch(console.error);
});

async function openAccountPanel(tab, pageUrl) {
  const path = normalizeAccountRoute(tab.url);
  if (!path || (pageUrl && pageUrl !== path) || !tab.active ||
      tab.pendingUrl || !Number.isInteger(tab.windowId)) return;

  // Dispatch open from the menu gesture before awaiting any other Chrome API.
  const opened = chrome.sidePanel.open({ windowId: tab.windowId });
  try {
    await opened;
    await navigator.locks.request(accountPanelLock, () => switchAccountContext(async () => {
      const current = await chrome.tabs.get(tab.id);
      if (!current.active || current.url !== path || current.pendingUrl || current.windowId !== tab.windowId) {
        throw new Error('切り替え元の公式タブが変わりました。');
      }
      const { [accountRouteKey]: previous } = await chrome.storage.session.get(accountRouteKey);
      const { path: previousPath } = await chrome.sidePanel.getOptions({});
      // Even the same numbered route can now refer to another Google login.
      await discardAccountAttachments();
      await discardAccountPins();
      await chrome.storage.session.set({ [accountRouteKey]: path });
      try {
        if (previousPath === path) await chrome.sidePanel.setOptions({ path: 'panel.html' });
        await chrome.sidePanel.setOptions({ path });
      } catch (error) {
        if (previous) await chrome.storage.session.set({ [accountRouteKey]: previous });
        else await chrome.storage.session.remove(accountRouteKey);
        if (previousPath) await chrome.sidePanel.setOptions({ path: previousPath });
        throw error;
      }
    }));
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }),
      chrome.action.setTitle({ tabId: tab.id, title: 'agy in chrome' }),
    ]);
  } catch {
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: '!' }),
      chrome.action.setTitle({ tabId: tab.id, title: 'アカウントを切り替えられませんでした。公式タブを開き直してお試しください。' }),
    ]);
  }
}

chrome.contextMenus.onClicked.addListener(async ({ menuItemId, pageUrl }, tab) => {
  if (tab?.id == null) return;
  if (menuItemId === accountMenuId) return openAccountPanel(tab, pageUrl);
  if (menuItemId === attachmentSetupMenu) {
    await chrome.tabs.create({ windowId: tab.windowId, url: chrome.runtime.getURL('attachment-settings.html') });
    return;
  }
  if (menuItemId === stageMarkdownMenu || menuItemId === stageImageMenu) {
    try {
      await navigator.locks.request('agy-stage-' + tab.windowId, () =>
        stageContext(tab, menuItemId === stageImageMenu ? 'image' : 'markdown'));
      await chrome.action.setBadgeText({ tabId: tab.id, text: '＋' });
      await chrome.action.setTitle({ tabId: tab.id, title: '資料を用意しました。下書きへの追加はまだ行われていません。' });
    } catch (error) {
      await Promise.allSettled([
        chrome.action.setBadgeText({ tabId: tab.id, text: '!' }),
        chrome.action.setTitle({ tabId: tab.id, title: error.message }),
      ]);
    }
    return;
  }
  if (menuItemId === copySelectionId || menuItemId === copyViewportId) {
    await navigator.locks.request('agy-page-context-copy', () => copyPageContext(tab, menuItemId === copyViewportId));
    return;
  }
  if (menuItemId === saveFileId) {
    await savePageContext(tab);
    return;
  }
  if (menuItemId !== contextMenuId || tab.windowId == null) return;
  try {
    await Promise.all([
      chrome.sidePanel.setOptions({ path: 'panel.html' }),
      chrome.sidePanel.open({ windowId: tab.windowId }),
    ]);
  } catch (error) {
    console.error('Could not open page context in the side panel', error);
  }
});

async function initializeRemotePanel() {
  await registerComposer().catch(console.error);
  await configureRemotePanel();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove(['outer', 'renderer'].map(frame => attachmentObservationPrefix + frame)).catch(console.error);
  chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: accountMenuId, title: 'このアカウントでサイドパネルを開く',
      contexts: ['page', 'action'], documentUrlPatterns: ['https://antigravity.google.com/u/*/remote', 'https://antigravity.google.com/u/*/'],
    });
    chrome.contextMenus.create({ id: contextMenuId, title: '接続先・資料プレビュー', contexts: ['action'] });
    chrome.contextMenus.create({ id: attachmentSetupMenu, title: 'ワンタッチ連携の設定・診断', contexts: ['action'] });
    const documentUrlPatterns = ['http://*/*', 'https://*/*'];
    chrome.contextMenus.create({
      id: stageMarkdownMenu, title: 'Antigravity にページ本文を渡す',
      contexts: ['page', 'selection'], documentUrlPatterns,
    });
    chrome.contextMenus.create({
      id: stageImageMenu, title: 'Antigravity に表示範囲の画像を渡す',
      contexts: ['page', 'selection'], documentUrlPatterns,
    });
    chrome.contextMenus.create({
      id: copySelectionId, title: '選択範囲とページ情報を Antigravity 用にコピー',
      contexts: ['selection'], documentUrlPatterns,
    });
    chrome.contextMenus.create({
      id: copyViewportId, title: '表示中のページ資料を Antigravity 用にコピー',
      contexts: ['page', 'selection'], documentUrlPatterns,
    });
    chrome.contextMenus.create({
      id: saveFileId, title: 'ページ資料を Antigravity 添付用ファイルに保存',
      contexts: ['page', 'selection'], documentUrlPatterns,
    });
  }).catch(console.error);
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  initializeRemotePanel().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  initializeRemotePanel().catch(console.error);
});

chrome.permissions.onRemoved.addListener(() => { registerComposer().catch(console.error); });
