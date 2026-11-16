import { captureMarkdown } from './markdown.mjs';

const officialOrigin = 'https://antigravity.google.com';
const rendererOrigin = 'https://antigravity.static.usercontent.goog';
const leaseMs = 60_000;
const stagedMs = 5 * 60_000;
const leases = new Map();

export const officialHosts = [officialOrigin + '/*', rendererOrigin + '/*'];
export const composerPermissions = { origins: officialHosts, permissions: ['tabs'] };
export const attachmentObservationPrefix = 'agy-attachment-observation-';
export const attachmentSetupMenu = 'configure-antigravity-attachments';
export const stageMarkdownMenu = 'stage-antigravity-markdown';
export const stageImageMenu = 'stage-antigravity-image';

export function sourceHost(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) ||
      [officialOrigin, rendererOrigin].includes(url.origin)) return null;
  return url.protocol + '//' + url.hostname + '/*';
}

export async function registerComposer() {
  return navigator.locks.request('agy-composer-registration', async () => {
    const id = 'agy-context-composer';
    const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (!await chrome.permissions.contains(composerPermissions)) {
      if (existing) await chrome.scripting.unregisterContentScripts({ ids: [id] });
      return false;
    }
    const css = ['composer-menu.css'];
    if (!existing) {
      await chrome.scripting.registerContentScripts([{
        id, matches: officialHosts, js: ['composer.js'], css, allFrames: true,
        runAt: 'document_idle', persistAcrossSessions: true,
      }]);
    } else if (existing.css?.join() !== css.join()) {
      await chrome.scripting.updateContentScripts([{ id, css }]);
    }
    return true;
  });
}

function isPanelSender(sender) {
  if (sender.id !== chrome.runtime.id || (sender.tab?.id != null && sender.tab.id !== -1)) return false;
  try {
    const origin = new URL(sender.url).origin;
    return origin === sender.origin && [officialOrigin, rendererOrigin].includes(origin);
  } catch {
    return false;
  }
}

async function focusedSource() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  if (win.id == null) throw new Error('Chrome の対象ウィンドウを選んでください。');
  if (!win.focused) {
    // Native panel focus can leave the browser window flag unset. The caller
    // still checks the composer focus; only accept this case with one window.
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (windows.length !== 1 || windows[0].id !== win.id) {
      throw new Error('Chrome の対象ウィンドウを選んでください。');
    }
  }
  const [tab] = await chrome.tabs.query({ windowId: win.id, active: true });
  return { windowId: win.id, tab };
}

const stagedKey = windowId => 'agy-staged-context-' + windowId;

async function getStaged(windowId) {
  const key = stagedKey(windowId);
  const { [key]: staged } = await chrome.storage.session.get(key);
  if (!staged || staged.expires > Date.now()) return staged;
  await chrome.storage.session.remove(key);
}

export async function stageContext(tab, format) {
  if (!sourceHost(tab.url)) throw new Error('このページは添付できません。');
  const context = format === 'image' ? await captureImage(tab) : await captureMarkdown(chrome, tab);
  if (!context) throw new Error('ページ資料を取得できませんでした。');
  await chrome.storage.session.set({
    [stagedKey(tab.windowId)]: {
      ...context, id: crypto.randomUUID(), format, title: context.title || tab.title || 'ページ資料',
      expires: Date.now() + stagedMs,
    },
  });
}

async function captureImage(tab) {
  let switched = false;
  const onActivated = ({ windowId, tabId }) => {
    if (windowId === tab.windowId && tabId !== tab.id) switched = true;
  };
  const onUpdated = (tabId, change) => {
    if (tabId === tab.id && (change.url || change.status === 'loading')) switched = true;
  };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  let dataUrl;
  try {
    const before = await chrome.tabs.get(tab.id);
    if (!before.active || before.url !== tab.url || before.windowId !== tab.windowId) {
      throw new Error('元のタブが切り替わりました。');
    }
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const after = await chrome.tabs.get(tab.id);
    if (switched || !after.active || after.url !== tab.url || after.windowId !== tab.windowId) {
      throw new Error('撮影中にタブが切り替わりました。');
    }
  } finally {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 4_000_000) {
    throw new Error('画像が大きすぎます。Chrome のウィンドウを小さくして再度お試しください。');
  }
  return { dataUrl, name: 'antigravity-page-context.png' };
}

async function recordPanelObservation(message, sender) {
  if (sender.id !== chrome.runtime.id) return { ok: false };
  const origin = new URL(sender.url).origin;
  const frame = origin === officialOrigin ? 'outer' : origin === rendererOrigin ? 'renderer' : null;
  if (!frame) return { ok: false };
  const status = isPanelSender(sender)
    ? message.state
    : (sender.tab?.id != null && sender.tab.id !== -1 ? 'ordinary-tab' : 'rejected-origin');
  if (!['connected', 'unexpected-frame', 'needs-permission', 'no-editor', 'editor-ready',
    'capture-start', 'draft-added', 'failed', 'ordinary-tab', 'rejected-origin'].includes(status)) return { ok: false };
  // This is deliberately limited to a status and timestamp, without page or conversation data.
  if (status !== 'ordinary-tab') {
    const observation = { status, at: Date.now() };
    const { visible, matched } = message.editorCounts ?? {};
    if (Number.isSafeInteger(visible) && Number.isSafeInteger(matched) &&
        visible >= matched && matched >= 0 && visible <= 1000) {
      observation.editorCounts = { visible, matched };
    }
    await chrome.storage.session.set({ [attachmentObservationPrefix + frame]: observation });
  }
  return { ok: true };
}

async function handlePanelRequest(message, sender) {
  if (message.action === 'observe') return recordPanelObservation(message, sender);
  if (!isPanelSender(sender)) throw new Error('公式サイドパネルで操作してください。');
  if (!await chrome.permissions.contains(composerPermissions)) {
    return { ok: false, denied: true, error: '拡張の設定で公式 Add context の添付を有効にしてください。' };
  }
  if (message.action === 'available') return { ok: true };
  const { windowId, tab } = await focusedSource();
  const staged = await getStaged(windowId);
  const now = Date.now();

  if (message.action === 'list') {
    for (const [key, lease] of leases) {
      if (lease.expires <= now || leases.size > 64) leases.delete(key);
    }
    const sourceKey = crypto.randomUUID();
    const host = sourceHost(tab?.url);
    leases.set(sourceKey, {
      windowId, tabId: tab?.id, url: tab?.url, stagedId: staged?.id,
      senderUrl: sender.url, senderDocumentId: sender.documentId, expires: now + leaseMs,
    });
    return {
      ok: true, sourceKey, active: Boolean(host),
      staged: Boolean(staged), stagedImage: staged?.format === 'image',
    };
  }

  if (message.action !== 'take' || !['active', 'staged'].includes(message.source) ||
      !['markdown', 'image'].includes(message.format)) throw new Error('添付操作が不明です。');
  const lease = leases.get(message.sourceKey);
  leases.delete(message.sourceKey);
  if (!lease || lease.expires <= now || lease.windowId !== windowId ||
      lease.senderUrl !== sender.url || lease.senderDocumentId !== sender.documentId ||
      lease.tabId !== tab?.id || lease.url !== tab?.url) {
    throw new Error('Add context を開き直して添付先を確認してください。');
  }
  if (message.source === 'staged') {
    if (!staged || staged.id !== lease.stagedId || staged.format !== message.format) {
      throw new Error('用意したページ資料が変わりました。Add context を開き直してください。');
    }
    return { ok: true, text: staged.text, dataUrl: staged.dataUrl, name: staged.name };
  }

  if (message.format !== 'markdown') throw new Error('この操作では本文を取得できます。');
  return captureActiveMarkdown(windowId, tab);
}

async function captureActiveMarkdown(windowId, tab) {
  const host = sourceHost(tab?.url);
  if (!host) throw new Error('このタブの本文は取得できません。閲覧中の Web ページを選んでください。');
  const hasSiteGrant = await chrome.permissions.contains({ origins: [host] });
  const assertSameSource = async () => {
    const source = await focusedSource();
    if (source.windowId !== windowId || source.tab?.id !== tab.id ||
        source.tab.url !== tab.url) throw new Error('元のページが切り替わりました。');
  };
  await assertSameSource();
  let context;
  try {
    // Chrome also authorizes this read when the toolbar gave this tab activeTab.
    context = await captureMarkdown(chrome, tab);
  } catch (error) {
    await assertSameSource();
    if (hasSiteGrant || /chrome-error|chromewebdata/i.test(error.message) ||
        !/cannot access contents of (the page|url)|host permission|must request permission/i.test(error.message)) throw error;
    await openSiteGrant(windowId, host);
    throw new Error('初回だけ、設定タブでサイトを許可してください。元のページに戻って Add context から選んでください。');
  }
  await assertSameSource();
  if (!context || !await chrome.permissions.contains(composerPermissions) ||
      (hasSiteGrant && !await chrome.permissions.contains({ origins: [host] }))) {
    throw new Error('読み取りの許可が取り消されました。');
  }
  return { ok: true, text: context.text, name: 'antigravity-page-context.md' };
}

async function openSiteGrant(windowId, host) {
  const key = 'agy-site-grant-' + windowId;
  const base = chrome.runtime.getURL('attachment-settings.html') + '?window=' + windowId + '&grant=';
  const { [key]: existing } = await chrome.storage.session.get(key);
  if (existing?.tabId != null && existing.host === host && existing.expires > Date.now()) {
    const tab = await chrome.tabs.get(existing.tabId).catch(() => null);
    if (tab?.windowId === windowId && tab.url === base + existing.grant) {
      await chrome.tabs.update(existing.tabId, { active: true });
      return;
    }
  }
  const grant = { grant: crypto.randomUUID(), host, expires: Date.now() + leaseMs };
  await chrome.storage.session.set({ [key]: grant });
  const tab = await chrome.tabs.create({ windowId, url: base + grant.grant });
  await chrome.storage.session.set({ [key]: { ...grant, tabId: tab?.id } });
}

export function installAttachmentMessaging() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'agy-context') return false;
    handlePanelRequest(message, sender).then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.windows.onRemoved.addListener(windowId => {
    chrome.storage.session.remove([stagedKey(windowId), 'agy-site-grant-' + windowId]).catch(console.error);
  });
}
