import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
async function waitFor(read, name, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for ' + name);
}

test('the native side panel scopes Add Context and pins to tabs and clears them on account handoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-native-panel-'));
  const extender = join(directory, 'extension');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html;charset=utf-8');
    if (request.url.startsWith('/r/fixture')) {
      const route = new URL(request.url, 'http://fixture').searchParams.get('p');
      const id = /^c\/([XY])$/.exec(route)?.[1] ?? 'X';
      response.end(`<style>body{margin:0}iframe{display:block;border:0;width:100%;height:350px}</style>
        <iframe src="${innerOrigin}/web/fixture/c/${id}"></iframe>
        <script>addEventListener('message',e=>{if(e.data?.draft)document.body.dataset.draft=e.data.draft;});</script>`);
    } else if (request.url === '/u/0/' || request.url === '/u/3/remote') {
      response.end('<button id="account-handoff">Open this account in the side panel</button>');
    } else if (/^\/web\/fixture\/c\/[XY]$/.test(request.url)) {
      response.end(`<style>body{margin:0}textarea{display:block;width:96%;height:80px}</style>
        <header><button aria-label="Search Conversations">Search</button></header>
        <textarea aria-label="Message input">Original draft</textarea>
        <button aria-label="Add context" onclick="document.querySelector('[role=menu]').hidden=false">Add context</button>
        <div role="menu" hidden><button>Files</button><button>Browser</button></div>
        <script>document.querySelector('textarea').addEventListener('input',e=>parent.postMessage({draft:e.target.value}, '*'));</script>`);
    } else {
      response.writeHead(404).end();
    }
  });
  const sourceServer = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html;charset=utf-8');
    response.end('<title>Native fixture source</title><article><p>' + 'An article from the active Chrome tab. '.repeat(24) + '</p></article>');
  });
  await new Promise(resolve => sourceServer.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const outerOrigin = 'http://127.0.0.1:' + port;
  const innerOrigin = 'http://localhost:' + port;
  const panelUrl = outerOrigin + '/r/fixture';
  let browser;

  try {
    await cp(sourceRoot, extender, {
      recursive: true, filter: path => !/^(\.git|\.local|node_modules|dist|tests|experiments)$/.test(path.slice(sourceRoot.length).split('/')[0]),
    });
    const manifestPath = join(extender, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.permissions.push('tabs');
    delete manifest.optional_permissions;
    manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
    manifest.content_scripts = [{
      matches: ['http://127.0.0.1/*'], js: ['account-test.js'],
    }];
    await writeFile(manifestPath, JSON.stringify(manifest));
    for (const name of ['attachment.mjs', 'composer.js', 'remote.mjs']) {
      const path = join(extender, name);
      const source = await readFile(path, 'utf8');
      const dashboard = name === 'remote.mjs' ? outerOrigin + '/' : panelUrl;
      await writeFile(path, source.replace('https://antigravity.google.com/', dashboard)
        .replace('https://antigravity.google.com', outerOrigin)
        .replace('https://antigravity.static.usercontent.goog', innerOrigin)
        .replace("officialOrigin + '/*'", "'http://127.0.0.1/*'")
        .replace("rendererOrigin + '/*'", "'http://localhost/*'"));
    }
    const backgroundPath = join(extender, 'background.mjs');
    await writeFile(backgroundPath, (await readFile(backgroundPath, 'utf8')) + `
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message === 'account-handoff-test') void openAccountPanel(sender.tab, sender.url);
      });
    `);
    await writeFile(join(extender, 'account-test.js'), `
      document.querySelector('#account-handoff')?.addEventListener('click', event => {
        if (event.isTrusted) void chrome.runtime.sendMessage('account-handoff-test');
      });
    `);
    await writeFile(join(extender, 'driver.html'), '<button>Open panel</button><script src="driver.js"></script>');
    await writeFile(join(extender, 'driver.js'), `document.querySelector('button').onclick = async () =>
      chrome.sidePanel.open({windowId:(await chrome.windows.getCurrent()).id});`);

    browser = await chromium.launchPersistentContext(join(directory, 'profile'), {
      channel: 'chromium', headless: false,
      args: ['--disable-extensions-except=' + extender, '--load-extension=' + extender],
    });
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker', { timeout: 10_000 });
    const driver = await browser.newPage();
    await driver.goto('chrome-extension://' + new URL(worker.url()).host + '/driver.html');
    await driver.waitForFunction(async url => (await chrome.sidePanel.getOptions({})).path === url, outerOrigin + '/');
    await driver.evaluate(async url => chrome.sidePanel.setOptions({ path: url }), panelUrl);
    await driver.waitForFunction(async url => (await chrome.sidePanel.getOptions({})).path === url, panelUrl);
    await driver.getByRole('button', { name: 'Open panel' }).click();

    const cdp = await browser.newCDPSession(driver);
    const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
    const outer = await waitFor(async () => (await targets()).find(target => target.url === panelUrl), 'outer panel');
    const inner = await waitFor(async () => (await targets()).find(target => target.url === innerOrigin + '/web/fixture/c/X'), 'cross-origin renderer');
    const outerClient = await connectTarget(cdp, outer.targetId);
    const innerClient = await connectTarget(cdp, inner.targetId);
    const source = await browser.newPage();
    await source.goto('http://127.0.0.1:' + sourceServer.address().port + '/source');
    await source.bringToFront();

    const click = async (name, host = outerClient, renderer = innerClient) => {
      const point = await waitFor(() => renderer.eval(`(() => {
        const button = [...document.querySelectorAll('button')].find(node => !node.disabled && (node.getAttribute('aria-label') === ${JSON.stringify(name)} || node.textContent === ${JSON.stringify(name)}));
        const rect = button?.getBoundingClientRect();
        return rect?.width && {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
      })()`), name);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await host.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
      }
    };
    await click('Add context');
    const menuStyle = await waitFor(() => innerClient.eval(`(() => {
      const group = document.querySelector('.agy-context-extension');
      if (group) return { heading: group.firstElementChild.textContent,
        display: getComputedStyle(group.querySelector('.agy-context-item')).display };
    })()`), 'extension menu styles');
    assert.deepEqual(menuStyle, { heading: 'agy in chrome', display: 'flex' });
    await click('現在の Chrome ページを下書きに挿入');
    const result = await waitFor(async () => {
      const observed = await innerClient.eval(`({status:document.querySelector('[role=status]')?.textContent,draft:document.querySelector('textarea').value})`);
      return observed.status && observed;
    }, 'insertion outcome');
    assert.match(result.draft, /^Original draft\n\n[\s\S]*Native fixture source[\s\S]*An article from the active Chrome tab/, result.status);
    assert.equal(result.status, '本文を下書きに挿入しました。');

    const pinLabel = 'このタブに会話を固定';
    await click(pinLabel);
    assert.match(await innerClient.eval("document.querySelector('[role=status]').textContent"), /下書きがあるため/);
    await innerClient.eval("document.querySelector('textarea').value = ''");
    await click(pinLabel);
    await waitFor(async () => {
      const error = await innerClient.eval("document.querySelector('[role=status]')?.textContent").catch(() => null);
      if (error && !/下書きがあるため/.test(error)) throw new Error(error);
      return (await targets()).some(target => target.url.includes('#agy-tab-pin='));
    }, 'pin activated');
    const pinned = async conversation => {
      const target = await waitFor(async () => (await targets()).find(item =>
        item.url.includes('p=c%2F' + conversation + '#agy-tab-pin=')), 'pinned conversation ' + conversation);
      const host = await connectTarget(cdp, target.targetId);
      const child = await waitFor(async () => (await targets()).find(item => item.parentId === target.targetId ||
        (item.url === innerOrigin + '/web/fixture/c/' + conversation && item.targetId !== inner.targetId)), 'pinned renderer');
      const renderer = await connectTarget(cdp, child.targetId);
      await waitFor(() => renderer.eval("document.querySelector('[aria-pressed=true].agy-pin-toggle')?.isConnected"), 'pressed pin');
      return { host, renderer, target };
    };
    const pinA = await pinned('X');
    await pinA.renderer.eval("document.querySelector('textarea').value = 'Draft kept on A'");
    const tabB = await browser.newPage();
    await tabB.goto('http://127.0.0.1:' + sourceServer.address().port + '/source');
    await tabB.evaluate(() => {
      document.title = 'Source B only';
      document.querySelector('article').textContent = 'The selected B tab contains a separate article. '.repeat(24);
    });
    await tabB.bringToFront();
    const shared = await waitFor(async () => (await targets()).find(item => item.url === panelUrl), 'shared conversation');
    const sharedHost = await connectTarget(cdp, shared.targetId);
    await sharedHost.eval("history.pushState(null, '', '/r/fixture?p=c%2FY'); document.querySelector('iframe').src = " + JSON.stringify(innerOrigin + '/web/fixture/c/Y'));
    const childY = await waitFor(async () => (await targets()).find(item => item.url === innerOrigin + '/web/fixture/c/Y'), 'shared Y');
    const sharedY = await connectTarget(cdp, childY.targetId);
    await sharedY.eval("document.querySelector('textarea').value = ''");
    await click(pinLabel, sharedHost, sharedY);
    const pinB = await pinned('Y');
    await pinB.renderer.eval("document.querySelector('textarea').value = 'Draft kept on B'");
    await source.bringToFront();
    assert.equal((await pinned('X')).target.targetId, pinA.target.targetId);
    assert.equal(await pinA.renderer.eval("document.querySelector('textarea').value"), 'Draft kept on A');
    await tabB.bringToFront();
    assert.equal((await pinned('Y')).target.targetId, pinB.target.targetId);
    assert.equal(await pinB.renderer.eval("document.querySelector('textarea').value"), 'Draft kept on B');

    const addContext = async (panel, expected) => {
      await waitFor(() => panel.renderer.eval("document.visibilityState === 'visible'"), 'active pane visibility');
      await click('Add context', panel.host, panel.renderer);
      await click('現在の Chrome ページを下書きに挿入', panel.host, panel.renderer);
      const draft = await waitFor(async () => {
        const value = await panel.renderer.eval("document.querySelector('textarea').value");
        return value.includes(expected) && value;
      }, 'draft from the active source');
      return draft;
    };
    assert.doesNotMatch(await addContext(pinB, 'Source B only'), /Native fixture source/);
    await source.bringToFront();
    assert.doesNotMatch(await addContext(pinA, 'Native fixture source'), /Source B only/);

    await tabB.bringToFront();
    await pinB.renderer.eval("document.querySelector('textarea').value = ''");
    await new Promise(resolve => setTimeout(resolve, 750));
    await click(pinLabel, pinB.host, pinB.renderer);
    await waitFor(async () => {
      const { values, current } = await worker.evaluate(async () => ({
        values: Object.values(await chrome.storage.session.get()).filter(row => row?.url?.includes('/r/fixture')),
        current: (await chrome.tabs.query({ active: true }))[0]?.id,
      }));
      return Number.isInteger(current) && values.length === 1 && values[0].url.endsWith('X');
    }, 'B unpinned');

    const requestAccountSwitch = async (page, path) => {
      const url = outerOrigin + path;
      await page.goto(url);
      await page.bringToFront();
      await page.getByRole('button', { name: 'Open this account in the side panel' }).click();
      await waitFor(async () => (await worker.evaluate(async () => (await chrome.sidePanel.getOptions({})).path)) === url,
        'account panel path ' + path);
      await waitFor(async () => (await targets()).filter(target => target.type === 'page' && target.url === url).length >= 2,
        'account is also visible in the native panel');
    };
    const accountTab = await browser.newPage();
    await worker.evaluate(async () => {
      await chrome.storage.session.set({ 'agy-staged-context-999': { text: 'prepared in the previous account' } });
    });
    await requestAccountSwitch(accountTab, '/u/3/remote');
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.getKeys())
      .filter(key => /^agy-(conversation-pin|staged-context)-/.test(key))), []);
    await source.bringToFront();
    assert.ok(await worker.evaluate(async () => !(await chrome.sidePanel.getOptions({
      tabId: (await chrome.tabs.query({ active: true }))[0].id,
    })).enabled));
    await requestAccountSwitch(accountTab, '/u/0/');
  } finally {
    await browser?.close();
    await Promise.all([server, sourceServer].map(activeServer => new Promise(resolve => activeServer.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});

async function connectTarget(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const result = JSON.parse(event.message);
    pending.get(result.id)?.(result);
  });
  const send = async (method, params) => {
    const id = ++sequence;
    let timeout;
    try {
      const response = new Promise((resolve, reject) => {
        pending.set(id, resolve);
        timeout = setTimeout(() => reject(new Error(method + ' did not respond')), 5000);
      });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
      const result = await response;
      if (result.error) throw Error(result.error.message);
      return result.result;
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  };
  return { send, eval: async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value };
}
