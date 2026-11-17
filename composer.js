(() => {
  const officialOrigin = 'https://antigravity.google.com';
  const rendererOrigin = 'https://antigravity.static.usercontent.goog';
  const ancestors = location.ancestorOrigins;
  const officialPage = location.origin === officialOrigin && window === window.top;
  const officialFrame = location.origin === rendererOrigin &&
    ancestors?.length === 1 && ancestors[0] === officialOrigin;
  function observe(state, editorCounts) {
    void chrome.runtime.sendMessage({ type: 'agy-context', action: 'observe', state, editorCounts }).catch(() => {});
  }
  if (!officialPage && !officialFrame) {
    observe('unexpected-frame');
    return;
  }


  const controlSelector = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';
  const editorSelector = 'textarea, [contenteditable]';
  const menuSelector = '[role="menu"], [role="dialog"], [role="listbox"]';
  let pendingMenu;
  let menuGroup;
  let scheduled = false;
  let allowedUntil = 0;
  let busy = false;
  let status;
  let statusTimer;
  let microphoneNotice;
  let microphoneCheck = 0;
  let pinUI;
  let checkingPin = false;
  let pinBusy = false;
  let lastEditorCounts;
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
  const pinToken = officialPage ? new URLSearchParams(location.hash.slice(1)).get('agy-tab-pin') : null;
  const documentKey = crypto.randomUUID();
  const routeRequest = 'agy-chrome-route-request';
  const routeReply = 'agy-chrome-route-reply';
  const routeChanged = 'agy-chrome-route-changed';

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
    event.source.postMessage({
      type: routeReply, nonce: event.data.nonce, routeFingerprint, url: location.href, pinToken,
    }, rendererOrigin);
  }

  function conversationRoute() {
    if (officialPage) return Promise.resolve({ fingerprint: location.href, url: location.href, pinToken, documentKey });
    return new Promise((resolve, reject) => {
      const nonce = crypto.randomUUID();
      function receive(event) {
        if (event.source !== window.parent || event.origin !== officialOrigin ||
            event.data?.type !== routeReply || event.data.nonce !== nonce ||
            typeof event.data.routeFingerprint !== 'string') return;
        clearTimeout(timeout);
        window.removeEventListener('message', receive);
        resolve({
          fingerprint: event.data.routeFingerprint, url: event.data.url, pinToken: event.data.pinToken,
          documentKey, rendererUrl: location.href,
        });
      }
      const timeout = setTimeout(() => {
        window.removeEventListener('message', receive);
        reject(new Error('外側の公式会話を特定できませんでした。'));
      }, 1200);
      window.addEventListener('message', receive);
      window.parent.postMessage({ type: routeRequest, nonce }, officialOrigin);
    });
  }

  function visibleEditors() {
    return [...document.querySelectorAll(editorSelector)].filter(element =>
      visible(element) && !element.matches('[readonly], [disabled], [aria-disabled="true"]') &&
      (element instanceof HTMLTextAreaElement || element.isContentEditable));
  }

  function isMessageEditor(element) {
    return Boolean(label(element) === 'Message input' ||
      element.closest('[aria-label="Message input"], [aria-label="メッセージ入力"]') ||
      (element.getAttribute('placeholder') ?? element.getAttribute('data-placeholder') ?? '')
        .startsWith('Ask anything'));
  }

  function conversationEditor() {
    const candidates = visibleEditors().filter(isMessageEditor);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function addContextTrigger(editor) {
    for (let container = editor?.parentElement; container && container !== document.body; container = container.parentElement) {
      const controls = [...container.querySelectorAll(controlSelector)].filter(node =>
        visible(node) && label(node).toLowerCase() === 'add context');
      if (controls.length === 1) return { container, button: controls[0] };
      if (controls.length > 1) break;
    }
    return null;
  }

  function closeContextMenu(menu, editor) {
    const trigger = addContextTrigger(editor)?.button;
    allowedUntil = 0;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (visible(menu)) trigger?.click();
    if (editor?.isConnected) editor.focus({ preventScroll: true });
  }

  function extensionChip() {
    const chip = document.createElement('span');
    chip.className = 'agy-brand-chip';
    chip.textContent = 'agy in chrome';
    return chip;
  }

  async function toggleConversationPin() {
    if (pinBusy) return;
    const editor = conversationEditor();
    if (editor) {
      let composer = editor.parentElement;
      while (composer && composer !== document.body &&
        ![...composer.querySelectorAll(controlSelector)].some(node => label(node) === 'Add context')) {
        composer = composer.parentElement;
      }
      const hasAttachment = composer && composer !== document.body &&
        [...composer.querySelectorAll(controlSelector)].some(node => visible(node) && /^Remove .+/i.test(label(node)));
      if (draftText(editor).trim() || hasAttachment) {
        report('下書きがあるため、内容を保存してから会話の固定を切り替えてください。');
        return;
      }
    }
    pinBusy = true;
    try {
      if (!document.hasFocus() || document.visibilityState !== 'visible') return;
      const result = await request('pin-toggle', undefined, undefined, undefined, pinUI?.view);
      if (!result?.ok) report(result?.error ?? '会話の固定を切り替えられませんでした。');
    } catch (error) {
      report(error.message);
    } finally {
      pinBusy = false;
      void refreshConversationPin();
    }
  }

  async function refreshConversationPin() {
    if (checkingPin || pinBusy || document.visibilityState !== 'visible') return;
    const search = [...document.querySelectorAll(controlSelector)].find(node =>
      (label(node) || node.title) === 'Search Conversations' && visible(node));
    if (!search) return;
    checkingPin = true;
    try {
      const view = await conversationRoute();
      const state = await request('pin-state', undefined, undefined, undefined, view);
      if (!search.isConnected) return;
      if (!pinUI?.group.isConnected || pinUI.search !== search) {
        pinUI?.group.remove();
        const group = document.createElement('span');
        group.className = 'agy-pin-controls';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'agy-pin-toggle';
        button.setAttribute('aria-label', 'このタブに会話を固定');
        const tip = document.createElement('span');
        tip.className = 'agy-pin-tip';
        tip.setAttribute('aria-hidden', 'true');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 9h18M6 6.5h3');
        svg.append(path);
        button.append(svg);
        button.addEventListener('click', event => {
          if (event.isTrusted) void toggleConversationPin();
        });
        button.addEventListener('keydown', event => {
          if (event.key === 'Escape') group.dataset.dismissed = 'true';
        });
        group.addEventListener('pointerleave', () => { delete group.dataset.dismissed; });
        button.addEventListener('blur', () => { delete group.dataset.dismissed; });
        group.append(button, tip);
        search.after(group);
        pinUI = { group, button, tip, search };
      }
      const pressed = state?.ok ? Boolean(state.pinned) : Boolean(view.pinToken);
      pinUI.view = view;
      if (pinUI.button.disabled === Boolean(state?.ready)) pinUI.button.disabled = !state?.ready;
      const hint = state?.ready ? (pressed ? 'このタブの固定を解除' : 'このタブに固定')
        : state?.error ?? '固定する公式会話を開いてください。';
      if (pinUI.tip.textContent !== hint) pinUI.tip.textContent = hint;
      if (pinUI.button.getAttribute('aria-pressed') !== String(pressed)) {
        pinUI.button.setAttribute('aria-pressed', String(pressed));
      }
    } catch {
      disableConversationPin();
    } finally {
      checkingPin = false;
    }
  }

  function disableConversationPin() {
    if (!pinUI) return;
    pinUI.button.disabled = true;
    pinUI.view = null;
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
    const name = /^chrome-page-[a-z0-9-]+[.](md|png)$/.test(payload.name ?? '') && payload.name.endsWith(extension)
      ? payload.name : 'chrome-page-' + crypto.randomUUID().slice(0, 8) + extension;
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

  function report(text, error = false) {
    const composer = addContextTrigger(conversationEditor())?.container;
    if (!status?.isConnected) {
      status = document.createElement('div');
      status.className = 'agy-action-notice';
      status.setAttribute('role', 'status');
    }
    status.classList.toggle('agy-action-notice-floating', !composer);
    status.classList.toggle('agy-action-notice-error', error);
    if (composer) {
      if (status.nextElementSibling !== composer) composer.before(status);
    } else if (status.parentElement !== document.body) {
      document.body.append(status);
    }
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.remove(), 6000);
  }

  function request(action, format, source, sourceKey, view) {
    return chrome.runtime.sendMessage({ type: 'agy-context', action, format, source, sourceKey, view });
  }

  function updateEditorObservation() {
    if (microphoneNotice && (microphoneNotice.url !== location.href ||
      !microphoneNotice.editor.isConnected || !visible(microphoneNotice.control) ||
      !isMicrophoneButton(microphoneNotice.control))) {
      clearMicrophoneNotice();
    }
    const inspected = visibleEditors();
    const editorCounts = { visible: inspected.length, matched: inspected.filter(isMessageEditor).length };
    const signature = editorCounts.visible + '/' + editorCounts.matched;
    if (signature === lastEditorCounts) return;
    lastEditorCounts = signature;
    observe(editorCounts.matched === 1 ? 'editor-ready' : 'no-editor', editorCounts);
  }

  function isMicrophoneButton(control) {
    return (label(control) || control.title) === 'Record voice memo';
  }

  function clearMicrophoneNotice() {
    microphoneNotice?.listener.abort();
    microphoneNotice?.element.remove();
    microphoneNotice = null;
  }

  async function explainMicrophone(control) {
    clearMicrophoneNotice();
    const check = ++microphoneCheck;
    const editor = conversationEditor();
    if (!editor) return;
    const url = location.href;
    // Let the official button handle activation and update its recording state first.
    await new Promise(resolve => setTimeout(resolve, 500));
    const blocked = document.featurePolicy?.allowsFeature('microphone') === false;
    const permission = blocked ? null :
      await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
    if (check !== microphoneCheck || location.href !== url || conversationEditor() !== editor ||
      !visible(control) || !isMicrophoneButton(control)) return;

    const text = blocked
      ? '公式フレームがマイクの使用を制限しています。'
      : permission?.state === 'prompt'
        ? 'Chrome の許可画面が出ない場合は、公式画面を通常のタブで開き、マイクを押して許可してください。そのあと、このサイドパネルで押し直してください。'
        : permission?.state === 'denied'
          ? 'マイクが許可されていません。Chrome のサイト設定と、macOS の「プライバシーとセキュリティ」のマイク設定を確認してください。'
          : null;
    if (!text) return;
    let composer = editor.parentElement;
    while (composer && !composer.contains(control)) composer = composer.parentElement;
    if (!composer || composer === document.body) return;

    const element = document.createElement('div');
    element.className = 'agy-microphone-notice';
    const message = document.createElement('span');
    message.setAttribute('role', 'status');
    element.append(message);
    composer.before(element);
    element.prepend(extensionChip());
    message.textContent = text;
    const listener = new AbortController();
    microphoneNotice = { element, editor, control, url, listener };
    permission?.addEventListener('change', clearMicrophoneNotice, { signal: listener.signal });
  }

  async function runAction(menu, selected, operation, source, format) {
    if (busy) return;
    const editor = conversationEditor();
    if (!editor) {
      closeContextMenu(menu, null);
      report('現在の下書きを一つに特定できませんでした。', true);
      return;
    }
    const originalUrl = location.href;
    const stillCurrent = () => location.href === originalUrl &&
      document.visibilityState === 'visible' && document.hasFocus() && conversationEditor() === editor;
    let input = operation === 'attach' ? attachmentInput(menu, editor, format) : null;
    closeContextMenu(menu, editor);
    if (operation === 'attach' && !input) {
      report('この画面の公式ファイル入力を特定できませんでした。本文の下書き挿入か右クリックのコピーをお使いください。');
      return;
    }

    busy = true;
    try {
      const originalRoute = await conversationRoute();
      if (selected.route.fingerprint !== originalRoute.fingerprint || !stillCurrent()) {
        throw new Error('会話が切り替わりました。Add context を開き直してください。');
      }
      const context = await request('take', format, source, selected.sourceKey, originalRoute);
      if (context?.denied) menuGroup?.remove();
      if (!context?.ok) throw new Error(context?.error || 'Chrome ページの資料を取得できませんでした。');
      if (originalRoute.fingerprint !== (await conversationRoute()).fingerprint || !stillCurrent()) {
        throw new Error('会話が切り替わりました。もう一度選んでください。');
      }
      const verified = await request('verify', format, source, selected.sourceKey, originalRoute);
      if (!verified?.ok || originalRoute.fingerprint !== (await conversationRoute()).fingerprint || !stillCurrent()) {
        throw new Error('会話が切り替わりました。もう一度選んでください。');
      }
      if (operation === 'attach') {
        if (!input.isConnected) input = attachmentInput(menu, editor, format);
        if (!input) throw new Error('公式の添付入力が閉じられました。下書き挿入をお試しください。');
        await attachFile(input, format, context, stillCurrent);
        report('公式の添付を確認しました。');
      } else {
        insertDraft(editor, context.text);
        report('本文を下書きに挿入しました。');
      }
    } catch (error) {
      report(error.message, true);
    } finally {
      busy = false;
      pendingMenu = null;
      menuGroup?.remove();
      menuGroup = null;
    }
  }

  function createMenuGroup(menu) {
    const group = document.createElement('div');
    group.className = 'agy-context-extension';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'agy in chrome');

    // Read visual properties only. Official classes and behavior stay on official rows.
    const rows = [...menu.querySelectorAll(controlSelector)].filter(visible);
    const fileRow = rows.find(row => label(row) === 'Files');
    const sample = fileRow && !fileRow.matches(':hover, :focus') ? fileRow
      : rows.find(row => !row.matches(':hover, :focus')) ?? fileRow;
    if (sample) {
      const row = getComputedStyle(sample);
      const text = [...sample.querySelectorAll('span')].find(span =>
        visible(span) && span.textContent.trim() === label(sample));
      const font = getComputedStyle(text ?? sample);
      const icon = sample.querySelector('svg')?.getBoundingClientRect();
      const values = {
        color: font.color,
        'font-family': font.fontFamily,
        'font-size': font.fontSize,
        'font-weight': font.fontWeight,
        'line-height': font.lineHeight,
        tracking: font.letterSpacing,
        gap: parseFloat(row.columnGap) > 0 ? row.columnGap : '',
        'row-height': sample.getBoundingClientRect().height + 'px',
        'inset-top': row.paddingBlockStart,
        'inset-bottom': row.paddingBlockEnd,
        'inset-start': row.paddingInlineStart,
        'inset-end': row.paddingInlineEnd,
        radius: row.borderRadius,
        'icon-width': icon?.width > 0 ? icon.width + 'px' : '',
        'icon-height': icon?.height > 0 ? icon.height + 'px' : '',
      };
      for (const [name, value] of Object.entries(values)) {
        if (value) group.style.setProperty('--agy-context-' + name, value);
      }
    }
    const header = [...menu.querySelectorAll('div, span, p, [role="heading"]')].find(node =>
      !node.childElementCount && node.textContent.trim().toLowerCase() === 'add context' && visible(node));
    if (header) {
      const style = getComputedStyle(header);
      for (const name of ['color', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding-inline-start', 'padding-inline-end']) {
        group.style.setProperty('--agy-heading-' + name, style.getPropertyValue(name));
      }
    }
    return group;
  }

  function optionIcon(operation) {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('class', 'agy-context-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.6');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', operation === 'attach'
      ? 'M8 12.5l5.5-5.5a2 2 0 0 1 2.8 2.8l-7 7a3.5 3.5 0 0 1-5-5l7.2-7.2a5 5 0 0 1 7.1 7.1l-6 6'
      : 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M13 3v5h5M11 17l1-3 6-6 2 2-6 6-3 1z');
    icon.append(path);
    return icon;
  }

  function addOption(group, menu, selected, description, operation, source, format) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.className = 'agy-context-item';
    item.tabIndex = -1;
    const text = document.createElement('span');
    text.className = 'agy-context-label';
    text.textContent = description;
    item.append(optionIcon(operation), text);
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
      const payload = await request('list', undefined, undefined, undefined, route);
      const selected = { ...payload, route };
      if (pendingMenu !== opening || !visible(menu)) return;
      if (!selected?.ok) {
        if (selected?.error) report(selected.error);
        return;
      }
      const group = createMenuGroup(menu);
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
        const heading = document.createElement('div');
        heading.className = 'agy-context-heading';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = 'agy in chrome';
        group.prepend(heading);
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
      updateEditorObservation();
      void showActions();
    });
  }

  void request('available').then(result => {
    observe(result?.ok ? 'connected' : result?.denied ? 'needs-permission' : 'rejected-origin');
    if (result?.ok) startMenuObserver();
  }).catch(() => {});

  function startMenuObserver() {
    if (officialPage) window.addEventListener('message', replyWithRoute);
    window.addEventListener('message', event => {
      if (!officialFrame || event.origin !== officialOrigin || event.source !== window.parent ||
        event.data?.type !== routeChanged) return;
      disableConversationPin();
    });
    window.navigation?.addEventListener('currententrychange', () => {
      disableConversationPin();
      if (!officialPage) return;
      for (const frame of document.querySelectorAll('iframe')) {
        frame.contentWindow?.postMessage({ type: routeChanged }, rendererOrigin);
      }
    });
    document.addEventListener('visibilitychange', () => {
      disableConversationPin();
      pendingMenu = null;
      void refreshConversationPin();
    });
    setInterval(() => { void refreshConversationPin(); }, 650);
    document.addEventListener('click', event => {
      const control = event.target instanceof Element ? event.target.closest(controlSelector) : null;
      if (event.isTrusted && control) {
        const name = label(control);
        if (name === 'Add context') {
          allowedUntil = Date.now() + 60_000;
          pendingMenu = null;
        }
        if (isMicrophoneButton(control)) void explainMicrophone(control);
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
      attributeFilter: ['aria-hidden', 'aria-label', 'class', 'data-state', 'hidden', 'style', 'title'],
    });
    scheduleMenuCheck();
  }
})();
