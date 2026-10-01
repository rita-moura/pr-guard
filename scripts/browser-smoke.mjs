import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Run after npm run build. No tokens, signed-in profile or GitHub writes are used.
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('dist/extension/manifest.json', root), 'utf8'));
const scripts = new Map(await Promise.all(manifest.content_scripts[0].js.map(async name =>
  [`/${name}`, await readFile(new URL(`dist/extension/${name}`, root), 'utf8')])));
const checks = `
const wait = () => new Promise(resolve => setTimeout(resolve, 400));
const panel = () => document.querySelector('#pr-guard-panel').shadowRoot;
const expect = (condition, message) => { if (!condition) throw Error(message); };
(async () => { try {
  await wait();
  const items = () => [...panel().querySelectorAll('li')];
  const row = id => items().find(item => item.textContent.includes(id + ':'))?.textContent;
  expect(items().length === 4 && items().every(item => item.textContent.startsWith('✅')), 'initial rules must pass');
  expect(panel().querySelector('#pr-guard-version').textContent === '${manifest.version}', 'version must be visible');
  const action = document.querySelector('#merge-action');
  action.textContent = 'Merge pull request';
  await wait();
  expect(row('squash').includes('selecionado: merge'), 'merge must fail squash rule');
  action.textContent = 'Rebase and merge';
  await wait();
  expect(row('squash').includes('selecionado: rebase'), 'rebase must fail squash rule');
  action.insertAdjacentHTML('afterend', '<button id="confirm">Confirm squash and merge</button>');
  await wait();
  expect(row('squash').startsWith('✅'), 'confirmation must take priority');
  document.querySelector('#confirm').remove();
  action.hidden = true;
  await wait();
  expect(panel().querySelector('summary').textContent.includes('1 não verificada(s)'), 'missing action must be unknown');
  const title = document.querySelector('.markdown-title, .js-issue-title');
  title.textContent = 'Título inválido';
  document.querySelector('input[type="checkbox"]').click();
  await wait();
  expect(row('titulo').startsWith('❌'), 'changed title must fail');
  expect(row('checklist').startsWith('⚠️'), 'unchecked item must warn');
  document.querySelector('.js-command-palette-pull-body, .js-issue-body').remove();
  await wait();
  expect(row('descricao').includes('Descrição indisponível'), 'review must not replace missing description');
  if (document.querySelector('header')) {
    document.querySelector('[data-component="BranchName"]').remove();
    await wait();
    expect(row('squash').includes('identificar head'), 'incomplete header must not use timeline branches');
  }
  document.body.dataset.result = 'passed';
} catch (error) { document.body.dataset.result = 'failed: ' + error.message; } })();`;
const pages = new Map(await Promise.all(['react', 'legacy'].map(async layout => {
  const fixture = await readFile(new URL(`test/fixtures/pr-${layout}.html`, root), 'utf8');
  return [layout, `<!doctype html><html><body>${fixture}
    <script>window.chrome = {runtime: {getManifest: () => ({version: '${manifest.version}'})}, storage: {local: {get: async () => ({policy: {...PRGuard.defaults, rules: PRGuard.defaults.rules.map(rule => rule.id === 'squash' ? {...rule, when: {...rule.when, base: ['main'], repository: ['example/repo']}} : rule)}})}, onChanged: {addListener() {}}}}; window.alert = () => {};</script>
    ${[...scripts.keys()].map(path => `<script src="${path}"></script>`).join('')}
    <script>${checks}</script></body></html>`];
})));
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const body = url.pathname === '/example/repo/pull/1' ? pages.get(url.searchParams.get('layout')) : scripts.get(url.pathname);
  response.writeHead(body ? 200 : 404, {'Content-Type': scripts.has(url.pathname) ? 'text/javascript' : 'text/html'});
  response.end(body ?? 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const layout of pages.keys()) {
    const profile = await mkdtemp(join(tmpdir(), 'pr-guard-test-'));
    try {
      const child = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
        `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=10000',
        `http://127.0.0.1:${server.address().port}/example/repo/pull/1?layout=${layout}`,
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
      console.log(`Chrome: ${layout} layout passed (title, body, checklist, branches, merge, updates and missing data).`);
    } finally { await rm(profile, { recursive: true, force: true }); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
