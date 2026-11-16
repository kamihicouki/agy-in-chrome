import { asPrompt, readContext } from './context.mjs';

const mode = document.querySelector('#mode');
const capture = document.querySelector('#capture');
const viewport = document.querySelector('#viewport');
const preview = document.querySelector('#preview');
const copy = document.querySelector('#copy');
const open = document.querySelector('#open');
const status = document.querySelector('#status');
const destination = 'https://antigravity.google.com/';
const modes = ['split', 'tab', 'window'];
const sourceWindow = chrome.windows.getCurrent().then(window => window.id);
let snapshot;
let busy = false;

function renderControls() {
  capture.disabled = open.disabled = mode.disabled = viewport.disabled = busy;
  preview.disabled = busy || !snapshot;
  copy.disabled = busy || !snapshot || !preview.value.trim();
}

function clearPreview() {
  snapshot = undefined;
  preview.value = '';
  renderControls();
}

async function activeTab() {
  const windowId = await sourceWindow;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

async function launch(tab) {
  if (mode.value === 'split' && tab?.id != null && tab.splitViewId === -1) {
    const opened = await chrome.tabs.create({
      url: destination, windowId: tab.windowId, splitWithTabId: tab.id, pinned: tab.pinned,
    }).catch(() => null);
    if (opened) return opened.splitViewId >= 0 ? '分割表示で開きました。' : '別タブで開きました。';
  }
  if (mode.value !== 'tab') {
    const window = await chrome.windows.create({ url: destination, type: 'popup', width: 480 }).catch(() => null);
    if (window) return '別ウィンドウで開きました。';
  }
  await chrome.tabs.create({ url: destination, windowId: await sourceWindow });
  return '別タブで開きました。';
}

async function perform(action, fallback) {
  if (busy) return;
  busy = true;
  renderControls();
  status.textContent = '';
  try {
    status.textContent = await action();
  } catch {
    status.textContent = fallback;
  } finally {
    busy = false;
    renderControls();
  }
}

mode.addEventListener('change', () => {
  chrome.storage.local.set({ openMode: mode.value }).catch(() => {
    status.textContent = '開き方を保存できませんでした。';
  });
});
const prefs = await chrome.storage.local.get('openMode').catch(() => ({}));
if (modes.includes(prefs.openMode)) mode.value = prefs.openMode;

preview.addEventListener('input', renderControls);
viewport.addEventListener('change', clearPreview);
capture.addEventListener('click', () => perform(async () => {
  clearPreview();
  const tab = await activeTab();
  if (tab?.id == null) return '共有するタブを選んでください。';
  const origin = new URL(tab.url);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.hostname === 'antigravity.google.com') {
    return '共有元の Web ページを選んでから取得してください。';
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, func: readContext, args: [viewport.checked],
  });
  const url = new URL(result.url);
  const current = await activeTab();
  if (current?.id !== tab.id || current.url !== result.url || tab.url !== result.url) {
    return '共有元のタブが変わりました。情報を取り直してください。';
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  snapshot = { tabId: tab.id, url: result.url };
  preview.value = asPrompt({ ...result, url: url.href });
  return '内容を確認してからコピーできます。';
}, '取得できませんでした。共有元の Web ページで拡張アイコンを押し、もう一度お試しください。'));

copy.addEventListener('click', () => perform(async () => {
  const tab = await activeTab();
  if (tab?.id !== snapshot?.tabId || tab.url !== snapshot.url) {
    clearPreview();
    return '共有元のタブが変わりました。情報を取り直してください。';
  }
  await navigator.clipboard.writeText(preview.value);
  clearPreview();
  try {
    return `${await launch(tab)} 公式画面の入力欄に貼り付けてください。`;
  } catch {
    return 'コピーしました。公式画面を開くボタンから開き、入力欄に貼り付けてください。';
  }
}, 'コピーできませんでした。内容を選択して手動でコピーできます。'));

open.addEventListener('click', () => perform(async () => launch(await activeTab()),
  '公式画面を開けませんでした。'));

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === snapshot?.tabId && (change.status === 'loading' || change.url)) {
    clearPreview();
    status.textContent = '共有元のページが変わりました。情報を取り直してください。';
  }
});
