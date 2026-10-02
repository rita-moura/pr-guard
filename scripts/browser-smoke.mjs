import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Run after npm run build. No tokens, signed-in profile or GitHub writes are used.
const root = new URL('../', import.meta.url);
const examplePolicy = JSON.parse(await readFile(new URL('policy.example.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('dist/extension/manifest.json', root), 'utf8'));
const scripts = new Map(await Promise.all(manifest.content_scripts[0].js.map(async name =>
  [`/${name}`, await readFile(new URL(`dist/extension/${name}`, root), 'utf8')])));
const storedPolicy = {...examplePolicy, blockMerge: true, rules: examplePolicy.rules.map(rule => rule.id === 'squash' ? {...rule, when: {...rule.when, base: ['main'], repository: ['example/repo']}} : rule)};
const storageMock = `
if (window.parent !== window) window.chrome = window.parent.chrome;
else {
  const listeners = [];
  const data = {policy: ${JSON.stringify(storedPolicy)}};
  if (new URLSearchParams(location.search).get('layout') === 'off') data.enabled = false;
  if (new URLSearchParams(location.search).get('layout') === 'empty') delete data.policy;
  window.chrome = {runtime: {getManifest: () => ({version: '${manifest.version}'})}, storage: {
    local: {get: async () => ({...data}), set: async values => {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, {oldValue: data[key], newValue}]));
      Object.assign(data, values);
      for (const listener of listeners) listener(changes, 'local');
    }}, onChanged: {addListener: listener => listeners.push(listener)}
  }};
}
window.alert = () => {};`;
const checks = `
const wait = () => new Promise(resolve => setTimeout(resolve, 400));
const panel = () => document.querySelector('#pr-guard-panel').shadowRoot;
const expect = (condition, message) => { if (!condition) throw Error(message); };
(async () => { try {
  await wait();
  if (new URLSearchParams(location.search).get('layout') === 'off') {
    expect(!document.querySelector('#pr-guard-panel'), 'saved OFF must hide panel at startup');
    expect(!document.querySelector('[data-pr-guard-blocked]'), 'saved OFF must not block buttons');
    await chrome.storage.local.set({enabled: true});
    await wait();
  }
  if (!location.pathname.includes('/pull/1')) {
    expect(!document.querySelector('#pr-guard-panel'), 'repository page must not show panel at startup');
    history.pushState({}, '', '/example/repo/pull/1');
    await wait();
  }
  if (new URLSearchParams(location.search).get('layout') === 'empty') {
    expect(JSON.stringify(PRGuard.defaults) === JSON.stringify({version: 1, rules: []}), 'build must not include preset company rules');
    expect(panel().querySelector('summary').textContent.includes('sem regras'), 'new install must explain missing configuration');
    expect(!panel().querySelector('#empty-state').hidden && !panel().querySelector('li'), 'new install must not claim checks passed');
    expect(!document.querySelector('[data-pr-guard-blocked]'), 'new install must not block merge');
    const initialOptions = document.createElement('iframe');
    initialOptions.src = '/options.html';
    const initialLoaded = new Promise(resolve => initialOptions.onload = resolve);
    document.body.append(initialOptions);
    await initialLoaded;
    await wait();
    const initialEditor = initialOptions.contentDocument.querySelector('#policy');
    expect(JSON.parse(initialEditor.value).rules.length === 0, 'editor must start without rules');
    initialEditor.value = JSON.stringify(${JSON.stringify(storedPolicy)});
    initialOptions.contentDocument.querySelector('#save').click();
    await wait();
    expect(panel().querySelector('#empty-state').hidden, 'saving policy must hide empty state');
    initialOptions.remove();
  }
  const items = () => [...panel().querySelectorAll('li')];
  const item = id => items().find(node => node.textContent.includes(id + ':'));
  const row = id => item(id)?.textContent;
  const state = id => item(id)?.dataset.status;
  expect(items().length === 4 && items().every(node => node.dataset.status === 'pass' && node.querySelector('svg')), 'initial rules must pass');
  expect(!document.querySelector('#merge-action').dataset.prGuardBlocked, 'passing rules must keep merge enabled');
  expect(panel().querySelector('#pr-guard-version').textContent === '${manifest.version}', 'version must be visible');
  const action = document.querySelector('#merge-action');
  action.textContent = 'Merge pull request';
  await wait();
  expect(row('squash').includes('selecionado: merge'), 'merge must fail squash rule');
  expect(action.dataset.prGuardBlocked === 'true' && !action.disabled, 'failing rule must block merge without touching disabled');
  let reached = false;
  document.body.addEventListener('click', () => { reached = true; }, { once: true });
  action.click();
  expect(!reached, 'blocked merge click must not reach the page');
  document.body.click();
  const originalPolicy = JSON.stringify((await chrome.storage.local.get('policy')).policy);
  const options = document.createElement('iframe');
  options.src = '/options.html';
  const loaded = new Promise(resolve => options.onload = resolve);
  document.body.append(options);
  await loaded;
  await wait();
  const toggle = options.contentDocument.querySelector('#enabled');
  expect(toggle.textContent === 'ON' && !toggle.disabled, 'options must show current enabled state');
  toggle.click();
  await wait();
  expect(toggle.textContent === 'OFF' && toggle.getAttribute('aria-checked') === 'false', 'switch must show OFF');
  expect((await chrome.storage.local.get('enabled')).enabled === false, 'OFF preference must be saved');
  expect(!document.querySelector('#pr-guard-panel') && !action.dataset.prGuardBlocked, 'OFF must remove panel and local block');
  let allowed = false;
  action.addEventListener('click', () => { allowed = true; }, {once: true});
  action.click();
  expect(allowed, 'OFF must allow merge click through without interception');
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw Error('storage unavailable'); };
  toggle.click();
  await wait();
  expect(toggle.textContent === 'OFF' && !toggle.disabled, 'failed save must keep OFF and allow retry');
  expect(options.contentDocument.querySelector('#enabled-status').textContent.includes('storage unavailable'), 'save error must be visible');
  chrome.storage.local.set = set;
  toggle.click();
  await wait();
  expect(toggle.textContent === 'ON' && action.dataset.prGuardBlocked === 'true', 'ON must restore panel and guard');
  expect(JSON.stringify((await chrome.storage.local.get('policy')).policy) === originalPolicy, 'switch must preserve rules');
  options.remove();
  for (const path of ['/example/repo', '/example/repo/pulls', '/example/repo/issues/1', '/example/repo/compare/main...fix/test', '/example/repo/pull/1/commits', '/example/repo/pull/1/checks', '/example/repo/pull/1/files', '/example/repo/pull/1/changes']) {
    history.pushState({}, '', path);
    await wait();
    expect(!document.querySelector('#pr-guard-panel') && !action.dataset.prGuardBlocked, 'leaving PR must clear panel and block: ' + path);
  }
  history.pushState({}, '', '/example/repo/pull/1?tab=conversation#discussion');
  await wait();
  expect(document.querySelector('#pr-guard-panel') && action.dataset.prGuardBlocked === 'true', 'returning to PR conversation must restore panel and block');
  action.disabled = true;
  action.textContent = 'Rebase and merge';
  await wait();
  expect(row('squash').includes('selecionado: rebase'), 'rebase must fail squash rule');
  action.insertAdjacentHTML('afterend', '<button id="confirm">Confirm squash and merge</button>');
  await wait();
  expect(state('squash') === 'pass', 'confirmation must take priority');
  expect(!action.dataset.prGuardBlocked && !document.querySelector('#confirm').dataset.prGuardBlocked, 'passing rules must unblock merge');
  expect(action.disabled, 'GitHub-disabled button must stay disabled');
  action.disabled = false;
  document.querySelector('#confirm').remove();
  action.hidden = true;
  await wait();
  expect(panel().querySelector('summary').textContent.includes('1 não verificada(s)'), 'missing action must be unknown');
  const title = document.querySelector('.markdown-title, .js-issue-title');
  title.textContent = 'Título inválido';
  document.querySelector('input[type="checkbox"]').click();
  await wait();
  expect(state('titulo') === 'error', 'changed title must fail');
  expect(state('checklist') === 'warning', 'unchecked item must warn');
  document.querySelector('.js-command-palette-pull-body, .js-issue-body').remove();
  await wait();
  expect(row('descricao').includes('Descrição indisponível'), 'review must not replace missing description');
  if (document.querySelector('header')) {
    document.querySelector('[data-component="BranchName"]').remove();
    await wait();
    expect(row('squash').includes('identificar head'), 'incomplete header must not use timeline branches');
  }
  await chrome.storage.local.set({policy: {version: 1, rules: []}});
  await wait();
  expect(panel().querySelector('summary').textContent.includes('sem regras'), 'empty saved policy must show empty state');
  expect(!document.querySelector('[data-pr-guard-blocked]'), 'clearing rules must release local merge block');
  document.body.dataset.result = 'passed';
} catch (error) { document.body.dataset.result = 'failed: ' + error.message; } })();`;
const pages = new Map(await Promise.all(['react', 'legacy', 'off', 'outside', 'empty'].map(async layout => {
  const fixture = await readFile(new URL(`test/fixtures/pr-${layout === 'legacy' ? 'legacy' : 'react'}.html`, root), 'utf8');
  return [layout, `<!doctype html><html><body>${fixture}
    <script>${storageMock}</script>
    ${[...scripts.keys()].map(path => `<script src="${path}"></script>`).join('')}
    <script>${checks}</script></body></html>`];
})));
const optionsHtml = (await readFile(new URL('dist/extension/options.html', root), 'utf8')).replace('<head>', `<head><script>${storageMock}</script>`);
scripts.set('/options.js', await readFile(new URL('dist/extension/options.js', root), 'utf8'));
const optionsCss = await readFile(new URL('dist/extension/options.css', root), 'utf8');
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const body = url.pathname === '/options.html' ? optionsHtml : url.pathname === '/options.css' ? optionsCss : ['/example/repo/pull/1', '/example/repo'].includes(url.pathname) ? pages.get(url.searchParams.get('layout')) : scripts.get(url.pathname);
  response.writeHead(body ? 200 : 404, {'Content-Type': scripts.has(url.pathname) ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html'});
  response.end(body ?? 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const layout of pages.keys()) {
    const profile = await mkdtemp(join(tmpdir(), 'pr-guard-test-'));
    try {
      const child = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
        `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=20000',
        `http://127.0.0.1:${server.address().port}/example/repo${layout === 'outside' ? '' : '/pull/1'}?layout=${layout}`,
      ]);
      let output = '', stderr = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { stderr += data; });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
      let code;
      try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); }
      finally { clearTimeout(timeout); }
      if (code !== 0 || !output.includes('data-result="passed"')) {
        throw new Error(`${layout}: ${output.match(/data-result="([^"]*)"/)?.[1] ?? stderr.slice(-1000)}`);
      }
      console.log(`Chrome: ${layout} layout passed (PR rules, ON/OFF, persistence, save errors and navigation).`);
    } finally { await rm(profile, { recursive: true, force: true }); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
