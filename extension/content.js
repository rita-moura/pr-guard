/* global PRGuard, PRGuardGitHub, chrome */
(() => {
  const { methodFromButton, selectedMergeMethod } = PRGuardGitHub;
  let policy = PRGuard.defaults;
  let enabled = false; // Wait for the saved preference before evaluating or blocking.
  const prRoute = pathname => pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
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
    li { display: flex; gap: 10px; align-items: flex-start; margin: 0 -16px; padding: 8px 16px 8px 13px; border-top: 1px solid #334155; border-left: 3px solid transparent; }
    li[data-status="error"] { background: #3d1218; border-left-color: #f85149; }
    li[data-status="warning"] { background: #3a2a0a; border-left-color: #d29922; }
    li[data-status="unknown"] { border-left-color: #8b949e; }
    li svg { flex: none; width: 18px; height: 18px; margin-top: 1px; }
    li[data-status="error"] strong { color: #ffa198; }
    li[data-status="warning"] strong { color: #f2cc60; }
    summary[data-state="error"] { color: #ff7b72; }
    summary[data-state="warning"] { color: #f2cc60; }
    summary[data-state="unknown"] { color: #c9d1d9; }
    small { display: block; color: #bac8d9; margin-top: 4px; }
    p { margin: 12px 16px; color: #bac8d9; font-size: 11px; }
  </style><details open><summary>PR Guard</summary><ul aria-live="polite"></ul><p id="empty-state" hidden>Nenhuma regra configurada. Adicione ou importe suas regras pelo ícone da extensão.</p><p>PR Guard <span id="pr-guard-version"></span> · Configure pelo ícone da extensão. Alertas locais; verifique também os checks do GitHub.</p></details>`;
  shadow.querySelector('#pr-guard-version').textContent = chrome.runtime.getManifest().version;
  const list = shadow.querySelector('ul');
  const summary = shadow.querySelector('summary');
  // SVG instead of emoji: emoji fall back to plain glyphs (e.g. "×") on some systems.
  const icons = {
    pass: ['Aprovado', '<circle cx="9" cy="9" r="9" fill="#2ea043"/><path d="M5 9.3l2.6 2.6L13 6.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
    error: ['Erro', '<circle cx="9" cy="9" r="9" fill="#da3633"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'],
    warning: ['Aviso', '<path d="M9 1.2L17.4 16H.6z" fill="#d29922" stroke="#d29922" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 6.5v4.2" stroke="#1c1300" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="13.3" r="1.1" fill="#1c1300"/>'],
    unknown: ['Não verificado', '<circle cx="9" cy="9" r="8" fill="none" stroke="#8b949e" stroke-width="2"/><path d="M9 4.8V9l2.8 1.8" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round"/>'],
  };
  const statusOf = result => result.status === 'fail' ? (result.severity === 'warning' ? 'warning' : 'error') : result.status;
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
    const route = prRoute(location.pathname);
    if (!route) return null;
    const titleEdit = document.querySelector('input[name="issue[title]"], input[name="pull_request[title]"]');
    const title = titleEdit && visible(titleEdit) ? titleEdit.value : document.querySelector('.js-issue-title, [data-testid="issue-title"], header[data-component="SplitPageLayout.Header"] h1 .markdown-title')?.textContent.trim();
    return { channel: 'browser', repository: `${route[1]}/${route[2]}`, title, body: bodyMarkdown(), head: branch('.head-ref', 1), base: branch('.base-ref', 0), mergeMethod: methodFromButton(clicked) || selectedMergeMethod(document.querySelectorAll('button')) };
  }
  function deactivate() {
    clearTimeout(timer);
    host.remove();
    lastRender = '';
    blockedStyle.remove();
    for (const button of document.querySelectorAll('[data-pr-guard-blocked]')) delete button.dataset.prGuardBlocked;
  }
  function render(clicked) {
    if (!enabled || !prRoute(location.pathname)) { deactivate(); return []; }
    const ctx = context(clicked);
    if (!host.isConnected) document.documentElement.append(host);
    let results;
    try { results = PRGuard.evaluate(policy, ctx).filter(result => result.status !== 'skip'); }
    catch (error) { results = [{ status: 'fail', severity: 'error', id: 'configuração', detail: error.message }]; }
    const unconfigured = Array.isArray(policy?.rules) && policy.rules.length === 0;
    const signature = JSON.stringify({ results, unconfigured });
    if (signature !== lastRender) {
      lastRender = signature;
      list.replaceChildren();
      shadow.querySelector('#empty-state').hidden = !unconfigured;
      for (const result of results) {
        const item = document.createElement('li');
        const status = statusOf(result);
        item.dataset.status = status;
        const [label, svg] = icons[status];
        item.innerHTML = `<svg viewBox="0 0 18 18" role="img" aria-label="${label}">${svg}</svg><div><strong></strong> <span></span></div>`;
        item.querySelector('strong').textContent = `${result.id}:`;
        item.querySelector('span').textContent = result.status === 'pass' ? 'Verificação aprovada.' : result.message || result.detail;
        if (result.status !== 'pass' && result.message && result.detail && result.message !== result.detail) {
          const detail = document.createElement('small');
          detail.textContent = result.detail;
          item.lastElementChild.append(detail);
        }
        list.append(item);
      }
      const failed = results.filter(r => r.status === 'fail').length;
      const unknown = results.filter(r => r.status === 'unknown').length;
      summary.textContent = unconfigured ? 'PR Guard · sem regras' : `PR Guard · ${failed} pendência(s)${unknown ? ` · ${unknown} não verificada(s)` : ''}`;
      const states = results.map(statusOf);
      summary.dataset.state = unconfigured ? 'unknown' : ['error', 'unknown', 'warning'].find(state => states.includes(state)) ?? 'pass';
    }
    // Reapplied on every render: GitHub may re-render the merge box.
    guardMerge(results);
    return results;
  }
  const blockedStyle = document.createElement('style');
  blockedStyle.textContent = 'button[data-pr-guard-blocked] { opacity: .45 !important; cursor: not-allowed !important; }';
  function guardMerge(results) {
    // Client-side only: GitHub's own rules remain the server-side lock.
    // Never touch `disabled`: GitHub owns it (conflicts, required checks, reviews).
    // Blocking is a marker for styling plus the click interception below.
    const block = policy.blockMerge === true && PRGuard.hasFailures(results);
    if (block && !blockedStyle.isConnected) document.head.append(blockedStyle);
    for (const button of document.querySelectorAll('button')) {
      const blocked = block && Boolean(methodFromButton(button));
      if (blocked !== (button.dataset.prGuardBlocked === 'true')) {
        if (blocked) button.dataset.prGuardBlocked = 'true';
        else delete button.dataset.prGuardBlocked;
      }
    }
  }
  const schedule = () => {
    clearTimeout(timer);
    if (!enabled || !prRoute(location.pathname)) { deactivate(); return; }
    timer = setTimeout(() => render(), 250);
  };
  chrome.storage.local.get(['policy', 'enabled']).then(data => {
    policy = data.policy ?? PRGuard.defaults;
    enabled = data.enabled !== false;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.policy) policy = changes.policy.newValue ?? PRGuard.defaults;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.policy || changes.enabled) render();
  });
  // Keep the content script on github.com so navigation into a PR also works
  // without a full reload. The panel and merge guard are restricted to the PR conversation.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded', 'aria-label', 'data-merge-method', 'value', 'disabled'] });
  document.addEventListener('input', schedule);
  document.addEventListener('turbo:load', schedule);
  document.addEventListener('turbo:before-visit', deactivate);
  window.addEventListener('popstate', () => render());
  window.navigation?.addEventListener('navigate', event => {
    if (!prRoute(new URL(event.destination.url).pathname)) deactivate();
  });
  window.navigation?.addEventListener('navigatesuccess', schedule);
  document.addEventListener('click', event => {
    if (!enabled || !prRoute(location.pathname)) return;
    const button = event.target.closest('button');
    if (methodFromButton(button)) {
      const results = render(button);
      if (policy.blockMerge === true && PRGuard.hasFailures(results)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const pending = results.filter(result => result.severity === 'error' && ['fail', 'unknown'].includes(result.status));
        window.alert(`PR Guard: merge bloqueado.\n${pending.map(result => `- ${result.id}: ${result.message || result.detail}`).join('\n')}`);
        return;
      }
      const wrong = results.find(result => result.type === 'merge-method' && result.status === 'fail');
      if (wrong) {
        // The MVP warns; this is not a server-side merge lock.
        window.alert(`PR Guard: ${wrong.message}\n${wrong.detail}`);
      }
    }
    schedule();
  }, true);
})();
