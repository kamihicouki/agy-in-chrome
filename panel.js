const split = document.querySelector('#split');
const status = document.querySelector('#status');
const destination = document.querySelector('a').href;

split.addEventListener('click', async () => {
  split.disabled = true;
  status.textContent = '';

  try {
    if (typeof chrome.tabs.createSplit !== 'function') {
      status.textContent = 'この Chrome では、拡張から分割表示を開けません。別タブをご利用ください。';
      return;
    }

    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current?.id == null || current.splitViewId !== -1) {
      status.textContent = '分割されていないタブを選んでから、もう一度お試しください。';
      return;
    }

    const opened = await chrome.tabs.create({
      url: destination,
      windowId: current.windowId,
      splitWithTabId: current.id,
      pinned: current.pinned,
    });

    status.textContent = opened.splitViewId >= 0
      ? '公式画面を隣に開きました。'
      : '分割できなかったため、公式画面を別タブで開きました。';
  } catch {
    status.textContent = '分割表示を開けませんでした。別タブをご利用ください。';
  } finally {
    split.disabled = false;
  }
});
