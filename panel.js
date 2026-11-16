import { asPrompt, readContext } from './context.mjs';
import { dashboard, normalizeRemoteLink, openRemote, remoteLinkKey } from './remote.mjs';

const byId = id => document.getElementById(id);
const thread = byId('thread');
const prompt = byId('prompt');
const status = byId('status');
const list = byId('session-list');
const connect = byId('connect');
const sessions = new Map();
const localSetup = byId('local-setup');
const sourceWindow = chrome.windows.getCurrent().then(window => window.id);
let port, session, connecting = false, starting = false, capturing = false;
let pending, sequence = 0;
let draft = { text: '', attachment: null };

function refresh() {
  byId('welcome').hidden = Boolean(session);
  thread.hidden = byId('composer').hidden = !session;
  byId('send').disabled = !port || connecting || starting || capturing || !session || session.closed || Boolean(pending) || !prompt.value.trim();
  byId('stop').hidden = !pending;
  byId('stop').disabled = Boolean(pending?.stopping);
  connect.hidden = Boolean(port && !connecting && !starting && session);
  connect.disabled = connecting || starting;
  connect.textContent = connecting || starting ? '接続中…' : port ? '新しい会話を開始' : 'サイドバーで新しい会話';
  byId('sessions').setAttribute('aria-expanded', String(!list.hidden));

  const attachment = draft.attachment;
  byId('attachment').hidden = !attachment;
  if (!attachment) {
    byId('attachment-preview').hidden = true;
    byId('inspect').setAttribute('aria-expanded', 'false');
  }
  if (attachment) {
    byId('inspect').textContent = attachment.title || '現在のタブ';
    byId('attachment-preview').textContent = attachment.text;
  }
}

function renderMessage(message) {
  if (!message.node) {
    const node = document.createElement('article');
    node.className = `message ${message.role}`;
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = message.role === 'user' ? 'あなた' : 'agy';
    node.append(label);
    if (message.source) {
      const source = document.createElement('small');
      source.className = 'source';
      source.textContent = message.source;
      node.append(source);
    }
    message.node = node;
    message.body = node.appendChild(document.createElement('p'));
  }
  message.body.textContent = message.text;
  return message.node;
}

function bottom() {
  thread.scrollTop = thread.scrollHeight;
}

function selectSession(next) {
  session = next;
  draft = session.draft;
  byId('title').textContent = session.title;
  prompt.value = draft.text;
  list.hidden = true;
  byId('attachment-preview').hidden = true;
  byId('inspect').setAttribute('aria-expanded', 'false');
  thread.replaceChildren(...session.messages.filter(message => message.text).map(renderMessage));
  bottom();
  refresh();
}

function showSessions() {
  const create = document.createElement('button');
  create.type = 'button';
  create.textContent = '新しい会話';
  create.disabled = !port || connecting || starting;
  create.addEventListener('click', startSession);
  list.replaceChildren(create);
  for (const entry of sessions.values()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = entry.title;
    if (entry === session) item.setAttribute('aria-current', 'true');
    item.addEventListener('click', () => selectSession(entry));
    list.append(item);
  }
}

function post(type, fields = {}) {
  const token = ++sequence;
  port.postMessage({ type, token, ...fields });
  return token;
}

function startSession() {
  if (!port || starting) return;
  starting = true;
  status.textContent = '会話を準備中…';
  post('new');
  showSessions();
  refresh();
}

function onNative(message) {
  if (message.type === 'ready') {
    connecting = false;
    startSession();
  } else if (message.type === 'session') {
    starting = false;
    const next = { id: message.sessionId, title: '新しい会話', messages: [],
      draft: session ? { text: '', attachment: null } : draft };
    sessions.set(next.id, next);
    selectSession(next);
    localSetup.hidden = true;
    status.textContent = '';
  } else if (message.type === 'chunk' && pending?.session.id === message.sessionId) {
    const item = pending.reply;
    const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 56;
    item.text += message.text;
    if (pending.session === session) {
      const node = renderMessage(item);
      if (!node.isConnected) thread.append(node);
      if (wasNearBottom) bottom();
    }
  } else if (message.type === 'done' && pending?.token === message.token) {
    const finished = pending;
    pending = undefined;
    status.textContent = message.reason === 'cancelled' ? '停止しました。' :
      finished.permission ? 'このパネルでは CLI の承認要求を拒否しました。' :
      finished.reply.text ? '' : 'テキスト応答はありませんでした。';
  } else if (message.type === 'permission' && pending?.session.id === message.sessionId) {
    pending.permission = true;
    status.textContent = 'このパネルでは CLI の承認要求を拒否しました。応答を待っています。';
  } else if (message.type === 'error') {
    connecting = starting = false;
    if (pending?.token === message.token) pending = undefined;
    status.textContent = message.code === -32000 || /auth|login|sign.in/i.test(message.message)
      ? 'Antigravity CLI で agy acp --login を実行してから再接続してください。'
      : message.message;
  }
  if (!list.hidden) showSessions();
  refresh();
}

connect.addEventListener('click', () => {
  localSetup.hidden = true;
  if (port) return startSession();
  connecting = true;
  status.textContent = 'ローカルの Antigravity CLI に接続中…';
  const connection = chrome.runtime.connectNative('com.agy_in_chrome.acp');
  port = connection;
  connection.onMessage.addListener(onNative);
  connection.onDisconnect.addListener(() => {
    const failure = chrome.runtime.lastError?.message;
    port = undefined;
    connecting = starting = false;
    pending = undefined;
    const missingHost = /native messaging host not found/i.test(failure ?? '');
    localSetup.hidden = !failure;
    status.textContent = missingHost
      ? 'ローカル中継が登録されていません。接続手順を開いて登録してください。'
      : failure
        ? 'ローカル中継に接続できませんでした。Chrome と拡張 ID の登録先を確認してください。'
        : 'ローカルの接続が終了しました。再接続すると新しい会話が始まります。';
    if (!list.hidden) showSessions();
    refresh();
  });
  // Reconnecting starts a fresh ACP process; prior sessions are local display only.
  for (const entry of sessions.values()) entry.closed = true;
  post('connect');
  refresh();
});

byId('sessions').addEventListener('click', () => {
  list.hidden = !list.hidden;
  showSessions();
  refresh();
});
prompt.addEventListener('input', () => { draft.text = prompt.value; refresh(); });
byId('composer').addEventListener('submit', event => {
  event.preventDefault();
  if (byId('send').disabled) return;
  const text = prompt.value.trim();
  const attachment = draft.attachment;
  const input = attachment ? `${text}\n\n${attachment.text}` : text;
  const user = { role: 'user', text, source: attachment?.title };
  const reply = { role: 'agy', text: '' };
  let token;
  try {
    token = post('prompt', { sessionId: session.id, text: input });
  } catch {
    status.textContent = '接続が切れました。下書きを保持しています。';
    return;
  }
  pending = { session, reply, token };
  session.messages.push(user, reply);
  thread.append(renderMessage(user));
  bottom();
  if (session.title === '新しい会話') {
    session.title = text.replace(/\s+/g, ' ').slice(0, 35);
    byId('title').textContent = session.title;
  }
  draft.text = prompt.value = '';
  draft.attachment = null;
  status.textContent = 'agy が応答中…';
  refresh();
});
prompt.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!byId('send').disabled) event.currentTarget.form.requestSubmit();
});
byId('stop').addEventListener('click', () => {
  if (!pending || pending.stopping) return;
  post('cancel', { sessionId: pending.session.id });
  pending.stopping = true;
  status.textContent = '停止を要求しました…';
  refresh();
});

async function activeTab() {
  return (await chrome.tabs.query({ active: true, windowId: await sourceWindow }))[0];
}

async function capture(includeViewport) {
  if (capturing) return;
  capturing = true;
  byId('capture').open = false;
  const targetDraft = draft;
  status.textContent = '表示中のタブを取得中…';
  refresh();
  try {
    const tab = await activeTab();
    if (tab?.id == null) throw new Error();
    const origin = new URL(tab.url);
    if (!['https:', 'http:'].includes(origin.protocol) || origin.hostname === 'antigravity.google.com') throw new Error();
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: readContext, args: [includeViewport],
    });
    const current = await activeTab();
    if (current?.id !== tab.id || current.url !== result.url || tab.url !== result.url) throw new Error();
    origin.username = origin.password = origin.search = origin.hash = '';
    targetDraft.attachment = { title: result.title || origin.hostname, text: asPrompt({ ...result, url: origin.href }) };
    status.textContent = '資料を添付しました。チップを押すと送る内容を確認できます。';
  } catch {
    status.textContent = '共有元の Web ページで拡張アイコンを押して、もう一度お試しください。';
  } finally {
    capturing = false;
    refresh();
  }
}

byId('capture-selection').addEventListener('click', () => capture(false));
byId('capture-viewport').addEventListener('click', () => capture(true));
byId('inspect').addEventListener('click', () => {
  const preview = byId('attachment-preview');
  preview.hidden = !preview.hidden;
  byId('inspect').setAttribute('aria-expanded', String(!preview.hidden));
});
byId('remove').addEventListener('click', () => { draft.attachment = null; refresh(); });

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
    await openRemote(chrome, url, mode, await sourceWindow);
  } catch {
    const feedback = session ? status : remoteStatus;
    feedback.textContent = '公式 Remote Control を開けませんでした。もう一度お試しください。';
  } finally {
    openingRemote = false;
  }
}

byId('desktop').addEventListener('click', () => launchRemote('split'));
byId('dashboard').addEventListener('click', () => launchRemote('split', true));
byId('choose-remote').addEventListener('click', () => launchRemote('split', true));
for (const mode of ['split', 'tab', 'window']) {
  byId(mode).addEventListener('click', () => launchRemote(mode));
}
refresh();
