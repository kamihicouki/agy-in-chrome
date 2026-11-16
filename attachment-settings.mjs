import { attachmentObservationPrefix, composerPermissions, officialHosts, registerComposer } from './attachment.mjs';

const params = new URLSearchParams(location.search);
const windowId = params.get('window');
const grant = params.get('grant');
const description = document.getElementById('description');
const status = document.getElementById('status');
const button = document.getElementById('allow');
const allSites = document.getElementById('all-sites');
const allSitesButton = document.getElementById('allow-all-sites');
const allSitesStatus = document.getElementById('all-sites-status');
const allSitePermissions = { origins: ['http://*/*', 'https://*/*'] };

const diagnosticLabels = {
  connected: '通信を確認',
  'unexpected-frame': '対象外のフレーム構成',
  'needs-permission': 'Chrome の許可が必要',
  'no-editor': '会話の入力欄を検出できません',
  'editor-ready': '会話の入力欄を検出',
  'capture-start': '取得を開始',
  'draft-added': '直近の下書き追加を確認',
  failed: '直近の操作が失敗。パネル内の案内を確認',
  'rejected-origin': '公式パネルとして確認できません',
};

async function showDiagnostics() {
  const body = document.getElementById('checks');
  const rows = await Promise.all([
    chrome.permissions.contains({ permissions: composerPermissions.permissions }),
    ...officialHosts.map(origin => chrome.permissions.contains({ origins: [origin] })),
    chrome.scripting.getRegisteredContentScripts({ ids: ['agy-context-composer'] }),
    chrome.storage.session.get(['outer', 'renderer'].map(id => attachmentObservationPrefix + id)),
  ]);
  const [tabs, outer, renderer, registered, observations] = rows;
  const describe = (frame, label) => {
    const seen = observations[attachmentObservationPrefix + frame];
    const counts = seen?.editorCounts;
    const hint = counts ? '、編集欄 ' + counts.visible + ' 件、会話入力欄に一致 ' + counts.matched + ' 件' : '';
    return label + ' — ' + (seen
      ? (diagnosticLabels[seen.status] ?? '状態不明') + hint + ' (' + new Date(seen.at).toLocaleTimeString('ja-JP') + ')'
      : 'まだ検出していません');
  };
  const lines = [
    '現在のタブを識別する許可 — ' + (tabs ? 'あり' : '未許可'),
    '公式パネルの許可 — ' + (outer ? 'あり' : '未許可'),
    '公式入力フレームの許可 — ' + (renderer ? 'あり' : '未許可'),
    '拡張スクリプト登録 — ' + (registered.length ? '登録済み' : '未登録'),
    describe('outer', '公式パネル'), describe('renderer', '公式入力フレーム'),
  ];
  body.replaceChildren(...lines.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  document.getElementById('diagnostics').hidden = false;
  const officialReady = tabs && outer && renderer && registered.length > 0;
  description.textContent = officialReady
    ? '公式 Antigravity へのページ添付は設定済みです。ページ本文を読む範囲は下で選べます。'
    : 'まず公式 Antigravity に添付項目を追加するための許可を設定します。ページ本文を読む範囲はその後に選べます。';
  button.hidden = officialReady;
  allSites.hidden = !officialReady;
}

async function refreshAllSites() {
  const granted = await chrome.permissions.contains(allSitePermissions);
  allSitesButton.hidden = granted;
  allSitesStatus.textContent = granted
    ? '一括許可済み。Add Context から閲覧中のページ資料を添付できます。'
    : '現在はサイトごとの許可、または閲覧中のページで拡張アイコンを押して利用します。';
}

async function refreshSetup() {
  await Promise.all([showDiagnostics(), refreshAllSites()]);
}

function installAllSitePermission() {
  const refresh = () => refreshSetup().catch(() => {
    allSitesStatus.textContent = '許可の状態を確認できませんでした。';
  });
  chrome.permissions.onAdded.addListener(refresh);
  chrome.permissions.onRemoved.addListener(refresh);
  allSitesButton.addEventListener('click', async event => {
    if (!event.isTrusted) return;
    allSitesButton.disabled = true;
    try {
      const granted = await chrome.permissions.request(allSitePermissions);
      await refreshAllSites();
      if (!granted) allSitesStatus.textContent = '一括許可を見送りました。サイトごとに許可して使えます。';
    } catch {
      allSitesStatus.textContent = '一括許可を設定できませんでした。サイトごとに許可して使えます。';
    } finally {
      allSitesButton.disabled = false;
    }
  });
}

async function configure() {
  const key = 'agy-site-grant-' + windowId;
  let permissions = composerPermissions;
  if (grant) {
    const { [key]: pending } = await chrome.storage.session.get(key);
    if (!pending || pending.grant !== grant || pending.expires <= Date.now()) {
      status.textContent = '許可の期限が切れました。公式パネルからもう一度開いてください。';
      return;
    }
    permissions = { origins: [pending.host] };
    description.textContent = '資料を選んだときだけ、' + pending.host.slice(0, -2) + ' の内容を読み取ります。';
    button.hidden = false;
  } else {
    await refreshSetup();
    installAllSitePermission();
    document.getElementById('check-again').addEventListener('click', () => {
      refreshSetup().catch(() => { status.textContent = '接続状態を確認できませんでした。'; });
    });
  }

  button.addEventListener('click', async () => {
    try {
      if (!await chrome.permissions.request(permissions)) {
        status.textContent = 'キャンセルしました。';
        return;
      }
      if (grant) {
        await chrome.storage.session.remove(key);
        status.textContent = '許可しました。このタブを閉じて元のページに戻って、公式パネルの Add context から選んでください。';
      } else {
        if (!await registerComposer()) throw new Error('Composer registration was not granted');
        await refreshSetup();
        status.textContent = '有効になりました。拡張の「接続先・資料プレビュー」を一度開き、公式サイドパネルに戻ると反映されます。';
      }
      button.hidden = true;
    } catch {
      status.textContent = '許可を設定できませんでした。';
    }
  });
}

configure().catch(() => { status.textContent = '設定を読み込めませんでした。'; });
