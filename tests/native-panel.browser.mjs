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

test('one click in a native cross-origin side panel inserts the active tab context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-native-panel-'));
  const extender = join(directory, 'extension');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html;charset=utf-8');
    if (request.url === '/panel') {
      response.end(`<style>body{margin:0}iframe{display:block;border:0;width:100%;height:350px}</style>
        <iframe src="${innerOrigin}/renderer"></iframe>
        <script>addEventListener('message',e=>{if(e.data?.draft)document.body.dataset.draft=e.data.draft;});</script>`);
    } else if (request.url === '/renderer') {
      response.end(`<style>body{margin:0}textarea{display:block;width:96%;height:80px}</style>
        <textarea aria-label="Message input">Original draft</textarea>
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
  const panelUrl = outerOrigin + '/panel';
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
    await writeFile(manifestPath, JSON.stringify(manifest));
    for (const name of ['attachment.mjs', 'composer.js', 'remote.mjs']) {
      const path = join(extender, name);
      const source = await readFile(path, 'utf8');
      await writeFile(path, source.replace('https://antigravity.google.com/', panelUrl)
        .replace('https://antigravity.google.com', outerOrigin)
        .replace('https://antigravity.static.usercontent.goog', innerOrigin)
        .replace("officialOrigin + '/*'", "'http://127.0.0.1/*'")
        .replace("rendererOrigin + '/*'", "'http://localhost/*'"));
    }
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
    await driver.waitForFunction(async url => (await chrome.sidePanel.getOptions({})).path === url, panelUrl);
    await driver.getByRole('button', { name: 'Open panel' }).click();

    const cdp = await browser.newCDPSession(driver);
    const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
    const outer = await waitFor(async () => (await targets()).find(target => target.url === panelUrl), 'outer panel');
    const inner = await waitFor(async () => (await targets()).find(target => target.url === innerOrigin + '/renderer'), 'cross-origin renderer');
    const outerClient = await connectTarget(cdp, outer.targetId);
    const innerClient = await connectTarget(cdp, inner.targetId);
    const source = await browser.newPage();
    await source.goto('http://127.0.0.1:' + sourceServer.address().port + '/source');
    await source.bringToFront();

    const point = await waitFor(() => innerClient.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'このページを下書きに追加');
      const rect = button?.getBoundingClientRect();
      return rect && {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
    })()`), 'injected button');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await outerClient.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    }
    const result = await waitFor(async () => {
      const observed = await innerClient.eval(`({status:document.querySelector('[role=status]')?.textContent,draft:document.querySelector('textarea').value})`);
      return observed.status && observed;
    }, 'insertion outcome');
    assert.match(result.draft, /^Original draft\n\n[\s\S]*Native fixture source[\s\S]*An article from the active Chrome tab/, result.status);
    assert.equal(result.status, '現在のページを下書きに追加しました。');
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
