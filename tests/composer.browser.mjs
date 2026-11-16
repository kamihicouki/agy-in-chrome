import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { readArticleMarkdown } from '../markdown.mjs';

const composerSource = await readFile(new URL('../composer.js', import.meta.url), 'utf8');
const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1sAAAAASUVORK5CYII=';
const controls = `
  <main id="composer">
    <textarea aria-label="Message input">既存の下書き</textarea>
    <button aria-label="Add context">Add context</button>
    <input type="file" id="attachment" accept=".md,.png" hidden>
    <div role="menu" hidden>
      <button aria-controls="attachment">Files</button><button>Browser</button>
    </div>
    <section id="attachments"></section>
    <button type="button" id="send">Send message</button>
  </main>
  <script>
    document.querySelector('[aria-label="Add context"]').onclick = () => {
      const menu = document.querySelector('[role="menu"]');
      menu.hidden = !menu.hidden;
    };
    document.querySelector('#attachment').onchange = ({target}) => {
      const file = target.files[0];
      document.querySelector('#attachments').append(Object.assign(document.createElement('span'),{textContent:file.name}));
      target.value = '';
    };
    document.querySelector('#send').onclick = () => document.body.dataset.sent = 'true';
  </script>`;

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
          if (req.action === 'available') return { ok: true };
          if (req.action === 'list') return {
            ok: true, title: '公開フィクスチャ', sourceKey: 'fixture', staged: true,
            stagedTitle: '公開フィクスチャ', stagedImage: true,
          };
          if (req.sourceKey !== 'fixture') throw new Error('Source identity missing');
          if (document.body.dataset.reject === 'true') return { ok: false, error: '元のタブが切り替わりました。' };
          return req.format === 'image'
            ? { ok: true, dataUrl: png } : { ok: true, text: '# Synthetic Markdown' };
        },
      };
    }, testPng);
    await page.goto(origin);
    await page.addScriptTag({ content: composerSource.replace('https://antigravity.google.com', origin) });
    await page.getByRole('button', { name: 'Add context' }).click();
    const draft = page.getByRole('menuitem', { name: '現在の Chrome ページを下書きに挿入' });
    await draft.evaluate(button => button.click());
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き');
    await draft.click();
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き\n\n# Synthetic Markdown');
    await page.getByRole('menuitem', { name: /現在の Chrome ページを添付/ }).click();
    await page.getByText('chrome-page.md', { exact: true }).waitFor();
    await page.getByRole('menuitem', { name: /用意した画像を添付/ }).click();
    await page.getByText('chrome-page.png', { exact: true }).waitFor();
    await page.locator('body').evaluate(body => { body.dataset.reject = 'true'; });
    await draft.click();
    await page.getByRole('status').getByText('元のタブが切り替わりました。').waitFor();
    assert.equal(await page.getByRole('textbox').inputValue(), '既存の下書き\n\n# Synthetic Markdown');
    assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Readability and Turndown extract Markdown without hidden or editable material', async () => {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent(`<title>Public example</title><article>
      <h1>Article heading</h1><p>${'Public article material with enough words for extraction. '.repeat(12)}</p>
      <p><strong>Formatting retained</strong> <a href="https://example.com/page?secret=hidden#token">Example link</a></p>
      <div style="display:none">hidden-fixture</div><div contenteditable="true">editor-fixture</div>
      </article>`);
    await page.addScriptTag({ path: new URL('../vendor/readability.js', import.meta.url).pathname });
    await page.addScriptTag({ path: new URL('../vendor/turndown.js', import.meta.url).pathname });
    const result = await page.evaluate(readArticleMarkdown);
    assert.match(result.markdown, /\*\*Formatting retained\*\*/);
    assert.match(result.markdown, /\[Example link\]\(https:\/\/example.com\/page\)/);
    assert.doesNotMatch(result.markdown, /secret=|#token|hidden-fixture|editor-fixture/);
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
          if (request.action === 'available') return { ok: true };
          if (request.action === 'list') return { ok: true, title: 'Fixture', sourceKey: 'fixture' };
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
