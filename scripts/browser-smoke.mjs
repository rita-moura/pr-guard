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
const storedPolicy = {...examplePolicy, blockMerge: true, rules: examplePolicy.rules.map(rule => rule.id === 'squash' ? {...rule, when: {...rule.when, head: ['FEATURE/*', 'FIX/*'], base: ['MAIN'], repository: ['example/repo']}} : rule)};
const storageMock = `
if (window.parent !== window) window.chrome = window.parent.chrome;
else {
  const listeners = [];
  const data = {policy: ${JSON.stringify(storedPolicy)}};
  if (new URLSearchParams(location.search).get('layout') === 'off') data.enabled = false;
  if (new URLSearchParams(location.search).get('layout') === 'empty') delete data.policy;
  window.chrome = {extension: {getViews: () => []}, runtime: {getManifest: () => ({version: '${manifest.version}'})}, storage: {
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
  expect(panel().querySelector('summary').textContent.includes('4 aprovada(s)'), 'passing summary must count verified rules');
  const savedPolicy = (await chrome.storage.local.get('policy')).policy;
  const headRef = document.querySelector('header [data-component="PageHeader.Description"]')?.querySelectorAll('[data-component="BranchName"]')[1] ?? document.querySelector('.head-ref');
  const originalHead = {text: headRef.textContent, title: headRef.getAttribute('title')};
  const scopedMergePolicy = {version: 1, blockMerge: true, rules: [
    {id: 'squash-tarefa', type: 'merge-method', method: 'squash', when: {head: ['PLBUX-*']}},
    {id: 'merge-commit-sync', type: 'merge-method', method: 'merge', when: {head: ['sync/*', 'sync-*']}}
  ]};
  for (const [head, expected, hidden, label] of [
    ['plbux-9515/data-structure', 'squash-tarefa', 'merge-commit-sync', 'Squash and merge'],
    ['PLBUX-9515/data-structure', 'squash-tarefa', 'merge-commit-sync', 'Squash and merge'],
    ['sync/mercury', 'merge-commit-sync', 'squash-tarefa', 'Merge pull request'],
    ['SYNC-main', 'merge-commit-sync', 'squash-tarefa', 'Merge pull request']
  ]) {
    headRef.textContent = head;
    headRef.setAttribute('title', head);
    document.querySelector('#merge-action').textContent = label;
    await chrome.storage.local.set({policy: scopedMergePolicy});
    await wait();
    expect(items().length === 1 && state(expected) === 'pass' && !item(hidden), 'branch must only show its matching merge rule: ' + head);
    expect(panel().querySelector('#scope-context').hidden, 'irrelevant filter diagnostics must stay hidden');
    expect(!document.querySelector('[data-pr-guard-blocked]'), 'passing scoped method must allow merge');
  }
  headRef.textContent = originalHead.text;
  if (originalHead.title === null) headRef.removeAttribute('title');
  else headRef.setAttribute('title', originalHead.title);
  document.querySelector('#merge-action').textContent = 'Squash and merge';
  await chrome.storage.local.set({policy: savedPolicy});
  await wait();

  for (const [field, pattern, actual] of [['repository', 'other/*', 'example/repo'], ['head', 'feature/*', 'fix/read-layout'], ['base', 'mercury', 'main']]) {
    const scoped = {id: 'escopo', type: 'title-prefix', prefixes: ['fix:'], when: {[field]: [pattern]}, message: 'Mensagem de erro personalizada'};
    await chrome.storage.local.set({policy: {version: 1, blockMerge: true, rules: [scoped]}});
    await wait();
    expect(panel().querySelector('summary').textContent.includes('nenhuma regra aplicável'), 'out-of-scope rules must not claim zero pending checks');
    expect(panel().querySelector('summary').dataset.state === 'unknown', 'out-of-scope summary must be neutral');
    expect(state('escopo') === 'skip' && row('escopo').includes(field) && row('escopo').includes(pattern) && row('escopo').includes(actual), 'skipped rule must explain the mismatched filter');
    expect(!row('escopo').includes(scoped.message), 'skip must show scope diagnostic instead of failure instructions');
    expect(panel().querySelector('#scope-context').textContent.includes('fix/read-layout → destino: main'), 'scope context must show detected branches');
    expect(!panel().querySelector('#empty-state').hidden, 'out-of-scope state must explain how to fix filters');
    expect(!document.querySelector('[data-pr-guard-blocked]'), 'out-of-scope rules must not block merge');
    await chrome.storage.local.set({policy: {version: 1, rules: [scoped, {id: 'aplicavel', type: 'title-prefix', prefixes: ['fix:']}]}});
    await wait();
    expect(state('aplicavel') === 'pass' && !item('escopo'), 'mixed policy must only show applicable rules');
    expect(panel().querySelector('summary').textContent.includes('1 aprovada(s)'), 'skipped rules must not count as approved');
  }
  await chrome.storage.local.set({policy: {version: 1, blockMerge: true, rules: savedPolicy.rules.map(rule => ({...rule, enabled: false}))}});
  await wait();
  expect(panel().querySelector('summary').textContent.includes('regras desativadas'), 'disabled policy must not claim approval');
  expect(panel().querySelector('summary').dataset.state === 'unknown' && !items().length, 'disabled rules must be neutral');
  expect(!document.querySelector('[data-pr-guard-blocked]'), 'disabled rules must not block merge');
  await chrome.storage.local.set({policy: savedPolicy});
  await wait();
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
  const optionsDoc = options.contentDocument;
  const importInput = optionsDoc.querySelector('#import');
  const importButton = optionsDoc.querySelector('#import-button');
  const policyEditor = optionsDoc.querySelector('#policy');
  const importStatus = () => optionsDoc.querySelector('#status').textContent;
  const importFile = async (text, name = 'regras.json') => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], name, {type: 'application/json'}));
    importInput.files = transfer.files;
    const settled = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!importButton.disabled) { observer.disconnect(); resolve(); }
      });
      observer.observe(optionsDoc.querySelector('#status'), {childList: true, subtree: true});
    });
    importInput.dispatchEvent(new Event('change', {bubbles: true}));
    await settled;
  };
  let pickerClicks = 0;
  importInput.addEventListener('click', event => { event.preventDefault(); pickerClicks++; });
  importButton.click();
  expect(pickerClicks === 1, 'options tab must open file picker');
  const imported = {version: 1, rules: [{id: 'importada', type: 'title-prefix', prefixes: ['fix:']}]};
  await importFile(JSON.stringify(imported));
  expect(JSON.stringify(JSON.parse(policyEditor.value)) === JSON.stringify(imported), 'valid JSON must populate editor: ' + importStatus());
  expect(importStatus().includes('Salvar regras'), 'import must explain the save step');
  expect(JSON.stringify((await chrome.storage.local.get('policy')).policy) === originalPolicy, 'import must not apply unsaved rules');
  expect(importInput.value === '' && !importButton.disabled, 'import must reset picker for reselecting the same file');
  policyEditor.value = '{}';
  await importFile('\uFEFF' + JSON.stringify(imported));
  expect(JSON.stringify(JSON.parse(policyEditor.value)) === JSON.stringify(imported), 'UTF-8 BOM and reimport must work: ' + importStatus() + ' / ' + policyEditor.value);
  const importedText = policyEditor.value;
  for (const invalid of ['{broken', JSON.stringify({version: 1, rules: [{id: 'bad', type: 'invalid'}]}), ' '.repeat(100001)]) {
    await importFile(invalid);
    expect(importStatus().includes('Não foi possível importar'), 'invalid import must show a readable error');
    expect(policyEditor.value === importedText, 'failed import must preserve editor');
    expect(importInput.value === '' && !importButton.disabled, 'failed import must allow retry');
  }
  const statusBeforeCancel = importStatus();
  importInput.dispatchEvent(new Event('change', {bubbles: true}));
  await wait();
  expect(policyEditor.value === importedText && importStatus() === statusBeforeCancel, 'cancel must preserve editor and status');
  optionsDoc.querySelector('#save').click();
  await wait();
  expect(JSON.stringify((await chrome.storage.local.get('policy')).policy) === JSON.stringify(imported), 'save must persist imported policy');
  expect(state('importada') === 'pass', 'saving import must reevaluate open PR');
  let optionsOpened = 0;
  chrome.extension.getViews = () => [options.contentWindow];
  chrome.runtime.openOptionsPage = async () => { optionsOpened++; };
  importButton.click();
  await wait();
  expect(optionsOpened === 1 && pickerClicks === 1, 'popup must open persistent options without opening a file dialog');
  chrome.runtime.openOptionsPage = async () => { throw Error('options unavailable'); };
  importButton.click();
  await wait();
  expect(importStatus().includes('options unavailable'), 'failure opening options must be visible');
  chrome.extension.getViews = () => [];
  delete chrome.runtime.openOptionsPage;
  policyEditor.value = originalPolicy;
  optionsDoc.querySelector('#save').click();
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
  return [layout, `<!doctype html><html><head><meta charset="utf-8"></head><body>${fixture}
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
        `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=30000',
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
