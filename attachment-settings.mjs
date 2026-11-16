import { composerPermissions, registerComposer } from './attachment.mjs';

const params = new URLSearchParams(location.search);
const windowId = params.get('window');
const grant = params.get('grant');
const description = document.getElementById('description');
const status = document.getElementById('status');
const button = document.getElementById('allow');

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
  } else {
    description.textContent = '公式 Antigravity に添付項目を追加し、現在の Chrome タブのタイトルと URL を特定できるようにします。ページ本文はサイトごとに許可します。';
  }

  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      if (!await chrome.permissions.request(permissions)) {
        status.textContent = 'キャンセルしました。';
        return;
      }
      if (grant) {
        await chrome.storage.session.remove(key);
        status.textContent = '許可しました。このタブを閉じて元のページに戻り、Add context を開き直してください。';
      } else {
        await registerComposer();
        status.textContent = '有効になりました。拡張の「接続先・資料プレビュー」を一度開き、公式サイドパネルに戻ると反映されます。';
      }
      button.hidden = true;
    } catch {
      status.textContent = '許可を設定できませんでした。';
    }
  });
}

configure().catch(() => { status.textContent = '設定を読み込めませんでした。'; });
