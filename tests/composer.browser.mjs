import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { readArticleMarkdown } from '../markdown.mjs';

const composerSource = await readFile(new URL('../composer.js', import.meta.url), 'utf8');
const menuStyle = new URL('../composer-menu.css', import.meta.url).pathname;
const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1sAAAAASUVORK5CYII=';
const controls = `
  <style>
    [role="menu"] { box-sizing: border-box; width: min(290px, 100%); padding: 4px; background: #f5f5f6; color: #41424a; }
    [role="menu"] > button {
      box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
      min-height: 28px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent;
      color: inherit; font: 500 14px/20px Arial, sans-serif; letter-spacing: 0.1px;
    }
    [role="menu"] > button > svg { width: 14px; height: 14px; }
    @media (prefers-color-scheme: dark) {
      [role="menu"] { background: #17171a; color: #bcbcc5; }
    }
  </style>
  <main id="composer">
    <textarea aria-label="Message input">既存の下書き</textarea>
    <button aria-label="Add context">Add context</button>
    <input type="file" id="attachment" accept=".md,.png" hidden>
    <div role="menu" hidden>
      <button role="menuitem" aria-controls="attachment"><svg aria-hidden="true"></svg><span>Files</span></button>
      <button role="menuitem"><svg aria-hidden="true"></svg><span>Browser</span></button>
    </div>
    <section id="attachments"></section>
    <button type="button" aria-label="Record voice memo">Microphone</button>
    <button type="button" id="send">Send message</button>
  </main>
  <script>
    const trigger = document.querySelector('[aria-label="Add context"]');
    trigger.onclick = () => {
      const menu = document.querySelector('[role="menu"]');
      menu.hidden = !menu.hidden;
    };
    document.querySelector('[role="menu"]').onkeydown = event => {
      if (event.key === 'Escape') {
        event.currentTarget.hidden = true;
        trigger.focus();
      }
    };
    document.querySelector('#attachment').onchange = ({target}) => {
      const file = target.files[0];
      document.querySelector('#attachments').append(Object.assign(document.createElement('span'),{textContent:file.name}));
      target.value = '';
    };
    document.querySelector('#send').onclick = () => document.body.dataset.sent = 'true';
  </script>`;

test('the official microphone keeps its own click and keyboard handling and reports permission blockers', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html;charset=utf-8');
    response.end(controls);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      chrome.runtime = { sendMessage: async () => ({ ok: true }) };
      Object.defineProperty(document, 'featurePolicy', {
        value: { allowsFeature: () => document.body.dataset.micPolicy !== 'blocked' },
      });
      window.micStatus = new EventTarget();
      Object.defineProperty(window.micStatus, 'state', { get: () => document.body.dataset.micPermission });
      navigator.permissions.query = async () => window.micStatus;
    });
    await page.goto(origin);
    const mic = page.getByRole('button', { name: 'Record voice memo' });
    await mic.evaluate(button => {
      button.addEventListener('click', () => {
        button.dataset.nativeClicks = Number(button.dataset.nativeClicks ?? 0) + 1;
        if (document.body.dataset.micPermission === 'granted') {
          button.setAttribute('aria-label', button.getAttribute('aria-label') === 'Record voice memo'
            ? 'Stop recording' : 'Record voice memo');
        }
      });
    });
    await page.addScriptTag({ content: composerSource.replace('https://antigravity.google.com', origin) });
    const state = async (permission, policy = 'allowed') => {
      await page.evaluate(([permission, policy]) => {
        document.body.dataset.micPermission = permission;
        document.body.dataset.micPolicy = policy;
      }, [permission, policy]);
    };
    const notice = page.getByRole('status');
    await state('prompt');
    await mic.evaluate(button => button.click());
    assert.equal(await notice.count(), 0);
    await mic.click();
    await notice.getByText(/公式画面を通常のタブで開き/).waitFor({ timeout: 3000 });
    await state('granted');
    await page.evaluate(() => window.micStatus.dispatchEvent(new Event('change')));
    await notice.waitFor({ state: 'detached' });
    await state('denied');
    await mic.press('Enter');
    await notice.getByText(/Chrome のサイト設定/).waitFor({ timeout: 3000 });
    await state('denied', 'blocked');
    await mic.click();
    await notice.getByText(/公式フレームがマイクの使用を制限/).waitFor({ timeout: 3000 });
    await state('granted');
    await mic.click();
    await page.getByRole('button', { name: 'Stop recording' }).press('Space');
    assert.equal(await mic.getAttribute('data-native-clicks'), '6');
    assert.equal(await notice.count(), 0);
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き');
    assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('isolated browser inserts draft text and verifies Markdown and PNG chips separately', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html;charset=utf-8');
    response.end(controls);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
    const page = await browser.newPage();
    await page.addInitScript(png => {
      chrome.runtime = {
        async sendMessage(req) {
          if (['available', 'observe'].includes(req.action)) return { ok: true };
          if (req.action === 'list') return {
            ok: true, active: true, sourceKey: 'fixture', staged: true, stagedImage: true,
          };
          if (req.sourceKey !== 'fixture') throw new Error('Source identity missing');
          if (document.body.dataset.reject === 'true') return { ok: false, error: '元のタブが切り替わりました。' };
          return req.format === 'image'
            ? { ok: true, dataUrl: png } : { ok: true, text: '# Synthetic Markdown' };
        },
      };
    }, testPng);
    await page.goto(origin);
    await page.addStyleTag({ path: menuStyle });
    await page.addScriptTag({ content: composerSource.replace('https://antigravity.google.com', origin) });
    await page.waitForFunction(() => !document.querySelector('button[title*="現在の Chrome タブ"]'));
    assert.equal(await page.getByRole('button', { name: 'このページを下書きに追加' }).count(), 0);
    const trigger = page.getByRole('button', { name: 'Add context' });
    const group = page.getByRole('group', { name: 'agy in chrome' });
    const files = page.getByRole('menuitem', { name: 'Files' });
    const browserItem = page.getByRole('menuitem', { name: 'Browser' });
    const attach = group.getByRole('menuitem', { name: '現在の Chrome ページを添付' });
    const draft = group.getByRole('menuitem', { name: '現在の Chrome ページを下書きに挿入' });
    const rowMetrics = row => row.evaluate(element => {
      const rowBox = element.getBoundingClientRect();
      const iconBox = element.querySelector('svg').getBoundingClientRect();
      const label = element.querySelector('span');
      const style = getComputedStyle(label);
      return [rowBox.height, iconBox.width, iconBox.height, iconBox.left - rowBox.left,
        label.getBoundingClientRect().left - rowBox.left, style.color, style.fontFamily,
        style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing,
        getComputedStyle(element).borderRadius];
    });
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await trigger.click();
      await group.getByText('agy in chrome', { exact: true }).waitFor();
      assert.deepEqual(await rowMetrics(attach), await rowMetrics(files), colorScheme);
      assert.deepEqual(await rowMetrics(draft), await rowMetrics(files), colorScheme);
      await browserItem.focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await attach.evaluate(item => item === document.activeElement && item.matches(':focus-visible')), true);
      await page.keyboard.press('ArrowDown');
      assert.equal(await draft.evaluate(item => item === document.activeElement), true);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      assert.equal(await browserItem.evaluate(item => item === document.activeElement), true);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
      await page.locator('.agy-context-extension').waitFor({ state: 'detached' });
    }
    await page.setViewportSize({ width: 180, height: 600 });
    await trigger.click();
    assert.ok((await draft.boundingBox()).height > (await files.boundingBox()).height);
    assert.equal(await group.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.setViewportSize({ width: 480, height: 600 });
    await draft.evaluate(button => button.click());
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き');
    await draft.press('Enter');
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き\n\n# Synthetic Markdown');
    assert.equal(await page.getByRole('menu').isVisible(), false);
    await trigger.click();
    await page.getByRole('menuitem', { name: /現在の Chrome ページを添付/ }).click();
    await page.getByText(/^chrome-page-[a-f0-9]+\.md$/).waitFor();
    assert.equal(await page.getByRole('menu').isVisible(), false);
    await trigger.click();
    await page.getByRole('menuitem', { name: /用意した画像を添付/ }).click();
    await page.getByText(/^chrome-page-[a-f0-9]+\.png$/).waitFor();
    await page.locator('body').evaluate(body => { body.dataset.reject = 'true'; });
    await trigger.click();
    await draft.click();
    await page.getByRole('status').getByText('元のタブが切り替わりました。').waitFor();
    const statusBox = await page.getByRole('status').boundingBox();
    const editorBox = await page.getByRole('textbox').boundingBox();
    assert.ok(statusBox.y + statusBox.height <= editorBox.y);
    await page.locator('body').evaluate(body => { delete body.dataset.reject; });
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き\n\n# Synthetic Markdown');
    assert.equal(await page.locator('body').getAttribute('data-sent'), null);

    await page.getByRole('textbox').evaluate(editor => {
      editor.addEventListener('input', () => { editor.value += '!'; }, { once: true });
    });
    const shortcut = draft;
    await trigger.click();
    await shortcut.click();
    await page.getByRole('status').getByText(/二重に追加しないよう/).waitFor();
    const unverified = await page.getByRole('textbox').inputValue();
    await trigger.click();
    await shortcut.click();
    await page.getByRole('status').getByText(/前回の追加結果が未確認/).waitFor();
    assert.equal(await page.getByRole('textbox').inputValue(), unverified);

    await page.getByRole('textbox').evaluate(editor => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.setAttribute('role', 'textbox');
      editable.setAttribute('aria-label', 'メッセージ入力');
      editable.style.minHeight = '40px';
      editable.textContent = 'Existing editable draft';
      editor.replaceWith(editable);
    });
    await trigger.click();
    await shortcut.click();
    await page.getByRole('status').getByText('本文を下書きに挿入しました。').waitFor();
    const editableDraft = await page.getByRole('textbox').innerText();
    assert.match(editableDraft, /^Existing editable draft[\s\S]*# Synthetic Markdown$/);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Readability and Turndown extract Markdown without hidden or editable material', async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.route('https://example.com/**', route => route.abort());
    await page.setContent(`<title>Public example</title><article>
      <h1>Article heading</h1><p>${'Public article material with enough words for extraction. '.repeat(12)}</p>
      <p><img src="https://example.com/diagram.png?token=secret" alt="Article diagram"><strong>Formatting retained</strong> <a href="https://example.com/page?secret=hidden#token">Example link</a></p>
      <div style="display:none">hidden-fixture</div><div contenteditable="true">editor-fixture</div>
      </article>`);
    await page.addScriptTag({ path: new URL('../vendor/readability.js', import.meta.url).pathname });
    await page.addScriptTag({ path: new URL('../vendor/turndown.js', import.meta.url).pathname });
    const result = await page.evaluate(readArticleMarkdown);
    assert.match(result.markdown, /\*\*Formatting retained\*\*/);
    assert.match(result.markdown, /\[Example link\]\(https:\/\/example.com\/page\)/);
    assert.match(result.markdown, /\[画像: Article diagram\]\(<https:\/\/example.com\/diagram.png>\)/);
    assert.doesNotMatch(result.markdown, /!\[|token=|secret=|#token|hidden-fixture|editor-fixture/);
  } finally {
    await browser.close();
  }
});

test('a parent route change cancels insertion even when the child editor stays mounted', async () => {
  const serve = async body => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html;charset=utf-8');
      response.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, origin: 'http://127.0.0.1:' + server.address().port };
  };
  const renderer = await serve(controls);
  const parent = await serve(`<iframe src="${renderer.origin}/renderer" width="480" height="500"></iframe>`);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      chrome.runtime = {
        async sendMessage(request) {
          if (['available', 'observe'].includes(request.action)) return { ok: true };
          if (request.action === 'list') return { ok: true, active: true, sourceKey: 'fixture' };
          return new Promise(resolve => {
            window.finishCapture = () => resolve({ ok: true, text: 'Context for the original draft' });
          });
        },
      };
    });
    await page.goto(parent.origin + '/r/original');
    const frame = page.frames().find(candidate => candidate.url().startsWith(renderer.origin));
    const script = composerSource.replace('https://antigravity.google.com', parent.origin)
      .replace('https://antigravity.static.usercontent.goog', renderer.origin);
    await page.addScriptTag({ content: script });
    await frame.addStyleTag({ path: menuStyle });
    await frame.addScriptTag({ content: script });
    await frame.getByRole('button', { name: 'Add context' }).click();
    await frame.getByRole('menuitem', { name: '現在の Chrome ページを下書きに挿入' }).click();
    await frame.waitForFunction(() => Boolean(window.finishCapture));
    await page.evaluate(() => history.pushState(null, '', '/r/different'));
    await frame.evaluate(() => window.finishCapture());
    await frame.getByRole('status').getByText(/会話が切り替わりました/).waitFor();
    assert.equal(await frame.getByRole('textbox').inputValue(), '既存の下書き');
  } finally {
    await browser?.close();
    await Promise.all([renderer.server, parent.server].map(server => new Promise(resolve => server.close(resolve))));
  }
});
