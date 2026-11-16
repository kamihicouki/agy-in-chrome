import { attachmentSetupMenu, installAttachmentMessaging, registerComposer, stageContext, stageImageMenu, stageMarkdownMenu } from './attachment.mjs';
import { captureTabContext, downloadContextFile } from './context.mjs';
import { dashboard, normalizeRemoteLink, remoteLinkKey } from './remote.mjs';

installAttachmentMessaging();

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
  if (tab?.id == null) return;
  if (menuItemId === attachmentSetupMenu) {
    await chrome.tabs.create({ windowId: tab.windowId, url: chrome.runtime.getURL('attachment-settings.html') });
    return;
  }
  if (menuItemId === stageMarkdownMenu || menuItemId === stageImageMenu) {
    try {
      await navigator.locks.request('agy-stage-' + tab.windowId, () =>
        stageContext(tab, menuItemId === stageImageMenu ? 'image' : 'markdown'));
      await chrome.action.setBadgeText({ tabId: tab.id, text: '＋' });
      await chrome.action.setTitle({ tabId: tab.id, title: '資料を用意しました。公式パネルの Add context から選んでください。' });
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
  chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({ id: contextMenuId, title: '接続先・資料プレビュー', contexts: ['action'] });
    chrome.contextMenus.create({ id: attachmentSetupMenu, title: '公式 Add context の添付を有効にする', contexts: ['action'] });
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
