(() => {
  const officialOrigin = 'https://antigravity.google.com';
  const rendererOrigin = 'https://antigravity.static.usercontent.goog';
  const ancestors = location.ancestorOrigins;
  const officialPage = location.origin === officialOrigin && window === window.top;
  const officialFrame = location.origin === rendererOrigin &&
    ancestors?.length === 1 && ancestors[0] === officialOrigin;
  if (!officialPage && !officialFrame) return;

  const controlSelector = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';
  const editorSelector = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
  const menuSelector = '[role="menu"], [role="dialog"], [role="listbox"]';
  let pendingMenu;
  let menuGroup;
  let scheduled = false;
  let allowedUntil = 0;
  let busy = false;
  let status;
  let statusTimer;
  let pageButton;
  let buttonEditor;
  const unverifiedDrafts = new WeakMap();

  function visible(element) {
    return element instanceof HTMLElement &&
      element.getClientRects().length > 0 &&
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }

  function label(element) {
    const references = element.getAttribute('aria-labelledby')?.trim().split(/\s+/);
    return (element.getAttribute('aria-label') ||
      references?.map(id => document.getElementById(id)?.textContent ?? '').join(' ') ||
      element.innerText || '').trim().replace(/\s+/g, ' ');
  }

  let observedOuterUrl;
  let routeFingerprint;
  const routeRequest = 'agy-chrome-route-request';
  const routeReply = 'agy-chrome-route-reply';

  function replyWithRoute(event) {
    if (event.origin !== rendererOrigin || event.data?.type !== routeRequest ||
        typeof event.data.nonce !== 'string') return;
    const frames = [...document.querySelectorAll('iframe')].filter(frame => {
      try {
        return frame.contentWindow === event.source && new URL(frame.src).origin === rendererOrigin;
      } catch {
        return false;
      }
    });
    if (frames.length !== 1) return;
    if (observedOuterUrl !== location.href) {
      observedOuterUrl = location.href;
      routeFingerprint = crypto.randomUUID();
    }
    event.source.postMessage({ type: routeReply, nonce: event.data.nonce, routeFingerprint }, rendererOrigin);
  }

  function conversationRoute() {
    if (officialPage) return Promise.resolve(location.href);
    return new Promise((resolve, reject) => {
      const nonce = crypto.randomUUID();
      function receive(event) {
        if (event.source !== window.parent || event.origin !== officialOrigin ||
            event.data?.type !== routeReply || event.data.nonce !== nonce ||
            typeof event.data.routeFingerprint !== 'string') return;
        clearTimeout(timeout);
        window.removeEventListener('message', receive);
        resolve(event.data.routeFingerprint);
      }
      const timeout = setTimeout(() => {
        window.removeEventListener('message', receive);
        reject(new Error('外側の公式会話を特定できませんでした。'));
      }, 1200);
      window.addEventListener('message', receive);
      window.parent.postMessage({ type: routeRequest, nonce }, officialOrigin);
    });
  }

  function conversationEditor() {
    const candidates = [...document.querySelectorAll(editorSelector)].filter(element =>
      visible(element) && !element.matches('[readonly], [disabled], [aria-disabled="true"]') &&
      (label(element) === 'Message input' || element.closest('[aria-label="Message input"], [aria-label="メッセージ入力"]') ||
        (element.getAttribute('placeholder') ?? element.getAttribute('data-placeholder') ?? '')
          .startsWith('Ask anything')));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function contextMenu() {
    const candidates = [...document.querySelectorAll(menuSelector)].filter(menu => {
      if (!visible(menu)) return false;
      const labels = [...menu.querySelectorAll(controlSelector)].filter(visible).map(label);
      return labels.includes('Files') && labels.includes('Browser');
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function attachmentInput(menu, editor, format) {
    const files = [...menu.querySelectorAll(controlSelector)].find(element => label(element) === 'Files');
    const target = files?.getAttribute('aria-controls');
    const controlledInput = target && document.getElementById(target);
    const inputs = new Set();
    if (controlledInput?.matches('input[type="file"]')) inputs.add(controlledInput);

    // Limit the search to the editor's own composer rather than unrelated page uploads.
    let container = editor.parentElement;
    while (container && container !== document.body) {
      const addContext = [...container.querySelectorAll(controlSelector)]
        .some(element => label(element) === 'Add context');
      if (addContext) {
        for (const input of container.querySelectorAll('input[type="file"]')) inputs.add(input);
        break;
      }
      container = container.parentElement;
    }
    const accepted = [...inputs].filter(input => {
      if (input.disabled || input.files.length) return false;
      const types = input.accept.toLowerCase().split(',').map(type => type.trim()).filter(Boolean);
      if (!types.length) return true;
      return format === 'image'
        ? types.some(type => ['image/*', 'image/png', '.png'].includes(type))
        : types.some(type => ['text/*', 'text/plain', 'text/markdown', '.md', '.markdown'].includes(type));
    });
    return accepted.length === 1 ? accepted[0] : null;
  }

  function attachmentCount(name) {
    return [...document.querySelectorAll('[aria-label], [title], span, p')].filter(element => {
      if (!visible(element)) return false;
      return element.getAttribute('title') === name ||
        element.getAttribute('aria-label') === name ||
        (!element.children.length && element.textContent.trim() === name);
    }).length;
  }

  async function attachFile(input, format, payload, stillCurrent) {
    const extension = format === 'image' ? '.png' : '.md';
    const name = 'chrome-page-' + crypto.randomUUID().slice(0, 8) + extension;
    const mime = format === 'image' ? 'image/png' : 'text/markdown';
    let contents = payload.text;
    if (format === 'image') {
      const encoded = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(payload.dataUrl ?? '')?.[1];
      if (!encoded) throw new Error('PNG データがありません。');
      contents = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    }
    if (!contents) throw new Error('添付する資料がありません。');
    if (!stillCurrent() || !input.isConnected || input.disabled || input.files.length) {
      throw new Error('添付先が変わりました。もう一度選んでください。');
    }

    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], name, { type: mime }));
    const before = attachmentCount(name);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let check = 0; check < 15; check++) {
      if (!stillCurrent()) throw new Error('会話が切り替わったため、添付結果を確認できません。');
      if (attachmentCount(name) > before) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('公式画面で添付を確認できませんでした。会話欄をご確認ください。');
  }

  function draftText(editor) {
    return editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText;
  }

  function checkDraft(editor) {
    if (unverifiedDrafts.get(editor) === draftText(editor)) {
      throw new Error('前回の追加結果が未確認です。下書きを確認して編集してから再実行してください。');
    }
  }

  function insertDraft(editor, text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('挿入する本文がありません。');
    const textarea = editor instanceof HTMLTextAreaElement;
    checkDraft(editor);
    const previous = draftText(editor);
    const normalizedText = text.replace(/\r\n?/g, '\n');
    const addition = previous.trim() ? '\n\n' + normalizedText : normalizedText;
    editor.focus({ preventScroll: true });
    if (textarea) {
      editor.setSelectionRange(previous.length, previous.length);
    } else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand('insertText', false, addition);
    const updated = draftText(editor);
    if (textarea ? updated !== previous + addition :
      (previous.trim() && !updated.startsWith(previous.trimEnd())) ||
        !updated.trimEnd().endsWith(normalizedText.trimEnd())) {
      if (updated !== previous) {
        unverifiedDrafts.set(editor, updated);
        throw new Error('下書きが変わりました。二重に追加しないよう、挿入結果を確認してください。');
      }
      throw new Error('下書きに追加できませんでした。');
    }
  }

  function report(text) {
    if (!status?.isConnected) {
      status = document.createElement('div');
      status.setAttribute('role', 'status');
      Object.assign(status.style, {
        position: 'fixed', insetInline: '12px', insetBlockEnd: '12px', zIndex: '2147483647',
        background: 'Canvas', color: 'CanvasText', border: '1px solid GrayText',
        borderRadius: '8px', padding: '8px 12px', pointerEvents: 'none',
      });
      document.body.append(status);
    }
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.remove(), 6000);
  }

  function request(action, format, source, sourceKey) {
    return chrome.runtime.sendMessage({ type: 'agy-context', action, format, source, sourceKey });
  }

  function updatePageButton() {
    const editor = conversationEditor();
    if (editor === buttonEditor && pageButton?.isConnected) return;
    pageButton?.remove();
    pageButton = null;
    buttonEditor = editor;
    if (!editor) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'このページを下書きに追加';
    button.title = '現在の Chrome タブのタイトル、URL、本文を下書きに追加';
    Object.assign(button.style, {
      display: 'block', margin: '4px 8px 2px', padding: '4px 9px',
      background: 'Canvas', color: 'CanvasText', border: '1px solid GrayText',
      borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
    });
    button.addEventListener('click', event => {
      if (!event.isTrusted) return;
      event.stopPropagation();
      if (!busy) void insertCurrentPage(editor, button);
    });
    editor.before(button);
    pageButton = button;
  }

  async function insertCurrentPage(editor, button) {
    busy = true;
    button.disabled = true;
    button.textContent = 'ページを取得中…';
    const originalUrl = location.href;
    try {
      checkDraft(editor);
      const route = await conversationRoute();
      const context = await request('insert-active');
      if (!context?.ok) throw new Error(context?.error || 'Chrome ページの資料を取得できませんでした。');
      if (route !== await conversationRoute() || location.href !== originalUrl ||
          conversationEditor() !== editor || document.visibilityState !== 'visible' || !document.hasFocus()) {
        throw new Error('会話が切り替わりました。もう一度選んでください。');
      }
      insertDraft(editor, context.text);
      report('現在のページを下書きに追加しました。');
    } catch (error) {
      report(error.message);
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'このページを下書きに追加';
    }
  }

  async function runAction(menu, selected, operation, source, format) {
    if (busy) return;
    const editor = conversationEditor();
    if (!editor) {
      report('現在の下書きを一つに特定できませんでした。');
      return;
    }
    const originalUrl = location.href;
    const stillCurrent = () => location.href === originalUrl &&
      document.visibilityState === 'visible' && document.hasFocus() && conversationEditor() === editor;
    const input = operation === 'attach' ? attachmentInput(menu, editor, format) : null;
    if (operation === 'attach' && !input) {
      report('この画面の公式ファイル入力を特定できませんでした。本文の下書き挿入か右クリックのコピーをお使いください。');
      return;
    }

    busy = true;
    try {
      const originalRoute = await conversationRoute();
      if (selected.route !== originalRoute || !stillCurrent()) {
        throw new Error('会話が切り替わりました。Add context を開き直してください。');
      }
      const context = await request('take', format, source, selected.sourceKey);
      if (context?.denied) menuGroup?.remove();
      if (!context?.ok) throw new Error(context?.error || 'Chrome ページの資料を取得できませんでした。');
      if (originalRoute !== await conversationRoute() || !stillCurrent()) {
        throw new Error('会話が切り替わりました。もう一度選んでください。');
      }
      if (operation === 'attach') {
        await attachFile(input, format, context, stillCurrent);
        report('公式の添付を確認しました。');
      } else {
        insertDraft(editor, context.text);
        report('本文を下書きに挿入しました。');
      }
    } catch (error) {
      report(error.message);
    } finally {
      busy = false;
      pendingMenu = null;
      menuGroup?.remove();
      menuGroup = null;
      if (visible(menu)) scheduleMenuCheck();
    }
  }

  function addOption(group, menu, selected, description, operation, source, format) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = description;
    Object.assign(item.style, {
      cursor: 'pointer', display: 'block', textAlign: 'start', width: '100%',
      padding: '7px 10px', borderRadius: '5px',
    });
    item.addEventListener('click', event => {
      if (!event.isTrusted) return;
      event.stopPropagation();
      void runAction(menu, selected, operation, source, format);
    });
    group.append(item);
  }

  async function showActions() {
    const menu = Date.now() <= allowedUntil && conversationEditor() ? contextMenu() : null;
    if (pendingMenu?.element === menu) return;

    menuGroup?.remove();
    menuGroup = null;
    pendingMenu = null;
    if (!menu) return;

    const opening = { element: menu };
    pendingMenu = opening;
    try {
      const route = await conversationRoute();
      const payload = await request('list');
      const selected = { ...payload, route };
      if (pendingMenu !== opening || !visible(menu) || !selected?.ok) return;
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Chrome ページ');
      if (selected.sourceKey && selected.active) {
        addOption(group, menu, selected, '現在の Chrome ページを添付', 'attach', 'active', 'markdown');
        addOption(group, menu, selected, '現在の Chrome ページを下書きに挿入', 'draft', 'active', 'markdown');
      }
      if (selected.staged) {
        addOption(group, menu, selected, selected.stagedImage ? '用意した画像を添付' : '用意した本文を添付',
          'attach', 'staged', selected.stagedImage ? 'image' : 'markdown');
        if (!selected.stagedImage) {
          addOption(group, menu, selected, '用意した本文を下書きに挿入', 'draft', 'staged', 'markdown');
        }
      }
      if (group.childElementCount) {
        menuGroup = group;
        menu.append(group);
      }
    } catch {
      // The extension can be reloaded without reloading the site.
    }
  }

  function scheduleMenuCheck() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      updatePageButton();
      void showActions();
    });
  }

  void request('available').then(result => {
    if (result?.ok) startMenuObserver();
  }).catch(() => {});

  function startMenuObserver() {
    if (officialPage) window.addEventListener('message', replyWithRoute);
    document.addEventListener('click', event => {
      const control = event.target instanceof Element ? event.target.closest(controlSelector) : null;
      if (event.isTrusted && control && label(control) === 'Add context') {
        allowedUntil = Date.now() + 60_000;
      }
      scheduleMenuCheck();
    }, true);
    document.addEventListener('keydown', event => {
      scheduleMenuCheck();
      if (!menuGroup?.isConnected || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const menu = menuGroup.parentElement;
      const entries = [...menu.querySelectorAll(controlSelector)].filter(visible);
      const extensionEntries = entries.filter(entry => menuGroup.contains(entry));
      const officialEntries = entries.filter(entry => !menuGroup.contains(entry) &&
        !entry.matches('[disabled], [aria-disabled="true"]'));
      const focused = document.activeElement;
      let next;
      if (event.key === 'ArrowDown' && focused === officialEntries.at(-1)) {
        next = extensionEntries[0];
      } else if (extensionEntries.includes(focused)) {
        const index = extensionEntries.indexOf(focused);
        next = event.key === 'ArrowDown'
          ? extensionEntries[index + 1] ?? officialEntries[0]
          : extensionEntries[index - 1] ?? officialEntries.at(-1);
      }
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        next.focus();
      }
    }, true);
    new MutationObserver(scheduleMenuCheck).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'data-state', 'hidden', 'style'],
    });
    scheduleMenuCheck();
  }
})();
