import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after a build with the same NEXT_PUBLIC_API_URL. Uses a fresh browser
// profile and intercepts session checks: no OAuth or real API access is needed.
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL).origin;
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const standaloneRoot = join(webRoot, '.next', 'standalone', 'apps', 'web');
// Next excludes static assets from standalone output. Production image assembly
// copies them explicitly; the local browser gate must exercise the same layout
// so client hydration can run.
await cp(
  join(webRoot, '.next', 'static'),
  join(standaloneRoot, '.next', 'static'),
  { force: true, recursive: true },
);
const profile = await mkdtemp(join(tmpdir(), 'omniroute-web-test-'));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const webOrigin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: standaloneRoot,
  // A runtime value must not override the public origin compiled into Next.js.
  env: {
    ...process.env,
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    NEXT_PUBLIC_API_URL: 'https://runtime-must-not-override.invalid',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverOutput += String(chunk);
});
let chrome;
let socket;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(`${webOrigin}/api/health`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    if (server.exitCode !== null)
      throw new Error(`Production web server exited: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, 'Production web server did not start');
  const landing = await fetch(webOrigin);
  assert.equal(landing.status, 200);
  const landingHtml = await landing.text();
  assert(landingHtml.includes('Choose the answer, not the provider.'));
  assert(!landingHtml.includes('Loading OmniRoute'));
  assert.match(landingHtml, /rel="icon"[^>]+icon\.svg/);
  const login = await fetch(`${webOrigin}/login`);
  assert.equal(login.status, 200);
  assert(
    (await login.text()).includes(`${apiOrigin}/v1/auth/google?returnTo=%2F`),
  );
  const protectedPage = await fetch(`${webOrigin}/chat/test`, {
    redirect: 'manual',
  });
  assert.equal(protectedPage.status, 307);
  const favicon = await fetch(`${webOrigin}/favicon.ico`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type'), /image\/svg\+xml/);
  assert((await favicon.text()).includes('#b9f379'));

  chrome = spawn(
    process.env.CHROME_BINARY ?? 'google-chrome',
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let debuggingPort;
  for (let i = 0; i < 100; i++) {
    try {
      debuggingPort = (
        await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
      ).split('\n')[0];
    } catch {
      /* starting */
    }
    if (debuggingPort) break;
    if (chrome.exitCode !== null)
      throw new Error('Chrome exited before starting');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(
    debuggingPort,
    'Chrome did not start; set CHROME_BINARY to a Chromium executable',
  );
  const targets = await (
    await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)
  ).json();
  socket = new WebSocket(
    targets.find((target) => target.type === 'page').webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const sessionUrls = [];
  function command(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timeout);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      sessionUrls.push(request.url);
      // Simulate API outage at the network boundary, including correct CORS.
      void command('Fetch.fulfillRequest', {
        requestId,
        responseCode: 503,
        responseHeaders: [
          { name: 'Access-Control-Allow-Origin', value: webOrigin },
          { name: 'Access-Control-Allow-Credentials', value: 'true' },
        ],
        body: '',
      });
    }
  };
  // Intercept this path regardless of origin, then assert the origin below.
  // A narrower expected-origin pattern would turn an accidental runtime origin
  // override into a misleading "no request" failure.
  await command('Fetch.enable', {
    patterns: [{ urlPattern: '*/v1/auth/me*' }],
  });
  await command('Page.navigate', { url: webOrigin });
  let html = '';
  for (let i = 0; i < 100; i++) {
    const result = await command('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    });
    html = result.result.value ?? '';
    if (html.includes('not been signed out')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(sessionUrls.length > 0, 'No browser session request observed');
  assert(
    sessionUrls.every((url) => url === `${apiOrigin}/v1/auth/me`),
    'Browser did not use the compiled API origin',
  );
  assert(html.includes('Choose the answer, not the provider.'));
  assert(html.includes('not been signed out'));
  assert(html.includes('Try again'));
  console.log(
    'Production smoke passed: public SSR/hydration, configured login, protected chat, icons, browser API origin, and outage UI.',
  );
} finally {
  socket?.close();
  chrome?.kill('SIGTERM');
  server.kill('SIGTERM');
}
