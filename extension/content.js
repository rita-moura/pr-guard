/* global PRGuard, PRGuardGitHub, chrome */
(() => {
  const { methodFromButton, selectedMergeMethod } = PRGuardGitHub;
  let policy = PRGuard.defaults;
  let lastRender = '';
  let timer;
  const host = document.createElement('div');
  host.id = 'pr-guard-panel';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { all: initial; position: fixed; bottom: 18px; right: 18px; z-index: 2147483646; font: 13px/1.5 system-ui,sans-serif; color: #edf3fa; }
    details { background: #121b27; border: 1px solid #506278; border-radius: 10px; box-shadow: 0 8px 28px #0005; width: min(370px, calc(100vw - 36px)); }
    summary { cursor: pointer; padding: 12px 16px; font-weight: 700; color: #80dfc3; }
    ul { list-style: none; margin: 0; padding: 0 16px; max-height: 45vh; overflow: auto; }
    li { padding: 8px 0; border-top: 1px solid #334155; }
    small { display: block; color: #bac8d9; margin-top: 4px; }
    p { margin: 12px 16px; color: #bac8d9; font-size: 11px; }
  </style><details open><summary>PR Guard</summary><ul aria-live="polite"></ul><p>PR Guard <span id="pr-guard-version"></span> · Configure pelo ícone da extensão. Alertas locais; verifique também os checks do GitHub.</p></details>`;
  shadow.querySelector('#pr-guard-version').textContent = chrome.runtime.getManifest().version;
  const list = shadow.querySelector('ul');
  const summary = shadow.querySelector('summary');
  const visible = node => node.getClientRects().length > 0;
  function branch(selector, index) {
    // The React header renders base then head as BranchName components.
    // Keep the query inside the PR header: timeline events also contain refs.
    const header = document.querySelector('header[data-component="SplitPageLayout.Header"]');
    const refs = header?.querySelectorAll('[data-component="PageHeader.Description"] [data-component="BranchName"]');
    const node = header ? (refs.length === 2 ? refs[index] : null) : document.querySelector(selector);
    if (!node) return undefined;
    const raw = node.getAttribute('title') || node.textContent.trim();
    return raw.replace(/^[^:]+:/, '').trim();
  }
  function bodyMarkdown() {
    const edit = [...document.querySelectorAll('textarea[name="pull_request[body]"], textarea[name="issue[body]"]')].find(visible);
    if (edit) return edit.value;
    const body = document.querySelector('.js-issue-body .comment-body, .js-issue-body .markdown-body, [data-testid="issue-body"] .markdown-body, .js-command-palette-pull-body .markdown-body');
    if (!body) return undefined;
    const clone = body.cloneNode(true);
    clone.querySelectorAll('pre').forEach(node => node.remove());
    clone.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(node => node.replaceWith(`\n## ${node.textContent}\n`));
    clone.querySelectorAll('li.task-list-item').forEach(node => {
      const checkbox = node.querySelector('input[type="checkbox"]');
      node.prepend(`\n- [${checkbox?.checked ? 'x' : ' '}] `);
      node.append('\n');
    });
    clone.querySelectorAll('p,div,ul,ol').forEach(node => node.append('\n'));
    return clone.textContent;
  }
  function context(clicked) {
    const route = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
    if (!route) return null;
    const titleEdit = document.querySelector('input[name="issue[title]"], input[name="pull_request[title]"]');
    const title = titleEdit && visible(titleEdit) ? titleEdit.value : document.querySelector('.js-issue-title, [data-testid="issue-title"], header[data-component="SplitPageLayout.Header"] h1 .markdown-title')?.textContent.trim();
    return { channel: 'browser', repository: `${route[1]}/${route[2]}`, title, body: bodyMarkdown(), head: branch('.head-ref', 1), base: branch('.base-ref', 0), mergeMethod: methodFromButton(clicked) || selectedMergeMethod(document.querySelectorAll('button')) };
  }
  function render(clicked) {
    const ctx = context(clicked);
    if (!ctx) { host.remove(); lastRender = ''; return []; }
    if (!host.isConnected) document.documentElement.append(host);
    let results;
    try { results = PRGuard.evaluate(policy, ctx).filter(result => result.status !== 'skip'); }
    catch (error) { results = [{ status: 'fail', severity: 'error', id: 'configuração', detail: error.message }]; }
    const signature = JSON.stringify(results);
    if (signature !== lastRender) {
      lastRender = signature;
      list.replaceChildren();
      for (const result of results) {
        const item = document.createElement('li');
        const icon = { pass: '✅', fail: result.severity === 'warning' ? '⚠️' : '❌', unknown: '⏳' }[result.status];
        item.textContent = `${icon} ${result.id}: ${result.status === 'pass' ? 'Verificação aprovada.' : result.message || result.detail}`;
        if (result.status !== 'pass' && result.message && result.detail && result.message !== result.detail) {
          const detail = document.createElement('small');
          detail.textContent = result.detail;
          item.append(detail);
        }
        list.append(item);
      }
      const failed = results.filter(r => r.status === 'fail').length;
      const unknown = results.filter(r => r.status === 'unknown').length;
      summary.textContent = `PR Guard · ${failed} pendência(s)${unknown ? ` · ${unknown} não verificada(s)` : ''}`;
    }
    return results;
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => render(), 250); };
  chrome.storage.local.get('policy').then(data => { policy = data.policy ?? PRGuard.defaults; render(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.policy) { policy = changes.policy.newValue ?? PRGuard.defaults; render(); } });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded', 'aria-label', 'data-merge-method', 'value'] });
  document.addEventListener('input', schedule);
  document.addEventListener('turbo:load', schedule);
  window.addEventListener('popstate', schedule);
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (methodFromButton(button)) {
      const results = render(button);
      const wrong = results.find(result => result.type === 'merge-method' && result.status === 'fail');
      if (wrong) {
        // The MVP warns; this is not a server-side merge lock.
        window.alert(`PR Guard: ${wrong.message}\n${wrong.detail}`);
      }
    }
    schedule();
  }, true);
})();
