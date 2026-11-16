import { captureTabContext } from './context.mjs';
import { dashboard, normalizeRemoteLink, openRemote, remoteLinkKey } from './remote.mjs';

const byId = id => document.getElementById(id);
const sourceWindow = chrome.windows.getCurrent().then(window => window.id);

const remoteInput = byId('remote-link');
const remoteError = byId('remote-error');
const remoteStatus = byId('remote-status');
let savedRemote = null;
let savingRemote = false;

function refreshRemote() {
  byId('remote-target').hidden = !savedRemote;
  byId('remote-target').textContent = savedRemote?.includes('?p=')
    ? '保存済みの会話を開きます。' : '保存済みの端末を開きます。';
  byId('choose-remote').hidden = !savedRemote;
  byId('clear-remote').hidden = !savedRemote;
  byId('save-remote').disabled = savingRemote;
  byId('clear-remote').disabled = savingRemote;
  remoteInput.disabled = savingRemote;
}

const remoteReady = chrome.storage.local.get(remoteLinkKey).then(values => {
  savedRemote = normalizeRemoteLink(values[remoteLinkKey]);
  remoteInput.value = savedRemote ?? '';
}).catch(() => {
  remoteStatus.textContent = '保存した接続先を読み込めませんでした。';
}).finally(refreshRemote);

remoteInput.addEventListener('input', () => {
  remoteInput.removeAttribute('aria-invalid');
  remoteError.textContent = '';
});

async function saveRemote(value) {
  if (savingRemote) return;
  savingRemote = true;
  refreshRemote();
  remoteError.textContent = '';
  remoteStatus.textContent = '';
  try {
    await remoteReady;
    if (value) await chrome.storage.local.set({ [remoteLinkKey]: value });
    else await chrome.storage.local.remove(remoteLinkKey);
    savedRemote = value;
    remoteInput.value = value ?? '';
    remoteInput.removeAttribute('aria-invalid');
    byId('remote-settings').open = false;
    byId('remote-settings').querySelector('summary').focus();
    remoteStatus.textContent = value ? '接続先を保存しました。' : '保存を解除しました。';
  } catch {
    remoteError.textContent = '接続先を保存できませんでした。もう一度お試しください。';
  } finally {
    savingRemote = false;
    refreshRemote();
  }
}

byId('remote-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = normalizeRemoteLink(remoteInput.value);
  if (!value) {
    remoteInput.setAttribute('aria-invalid', 'true');
    remoteError.textContent = '公式 Remote Control の端末または会話の URL を入力してください。';
    remoteInput.focus();
    return;
  }
  void saveRemote(value);
});
byId('clear-remote').addEventListener('click', () => saveRemote(null));

let openingRemote = false;
async function launchRemote(mode, chooseAgain = false) {
  if (openingRemote) return;
  openingRemote = true;
  byId('options').open = false;
  try {
    await remoteReady;
    const url = chooseAgain ? dashboard : savedRemote ?? dashboard;
    if (mode === 'panel') {
      await chrome.sidePanel.setOptions({ path: url });
      return;
    }
    const windowId = await sourceWindow;
    await navigator.locks.request('agy-remote-view', () =>
      openRemote(chrome, url, mode, windowId, { reset: chooseAgain, screen }));
  } catch {
    remoteStatus.textContent = '公式 Remote Control を開けませんでした。もう一度お試しください。';
  } finally {
    openingRemote = false;
  }
}

byId('desktop').addEventListener('click', () => launchRemote('panel'));
byId('dashboard').addEventListener('click', () => launchRemote('panel', true));
byId('choose-remote').addEventListener('click', () => launchRemote('panel', true));
for (const mode of ['split', 'tab', 'window']) {
  byId(mode).addEventListener('click', () => launchRemote(mode));
}

const contextStatus = byId('context-status');
const preview = byId('attachment-preview');
const copy = byId('copy-context');

async function capture(includeViewport) {
  const controls = ['capture-selection', 'capture-viewport'].map(byId);
  controls.forEach(button => { button.disabled = true; });
  preview.value = '';
  preview.hidden = copy.hidden = true;
  contextStatus.textContent = '表示中のタブを取得中…';
  try {
    const windowId = await sourceWindow;
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    const context = await captureTabContext(chrome, tab, includeViewport);
    if (context === null) {
      contextStatus.textContent = 'このページからは資料を取得できません。';
      return;
    }
    preview.value = context.text;
    preview.hidden = copy.hidden = false;
    contextStatus.textContent = '内容を確認してコピーし、公式会話の入力欄に貼り付けてください。';
  } catch {
    contextStatus.textContent = '取得できませんでした。共有元の Web ページで拡張アイコンを右クリックし、「接続先・資料プレビュー」を選んでください。';
  } finally {
    controls.forEach(button => { button.disabled = false; });
  }
}

byId('capture-selection').addEventListener('click', () => capture(false));
byId('capture-viewport').addEventListener('click', () => capture(true));
copy.addEventListener('click', async () => {
  if (!preview.value.trim()) return;
  try {
    await navigator.clipboard.writeText(preview.value);
    contextStatus.textContent = 'コピーしました。公式会話の入力欄に貼り付けてください。';
  } catch {
    preview.focus();
    preview.select();
    contextStatus.textContent = 'コピーできませんでした。選択した資料を手動でコピーしてください。';
  }
});
