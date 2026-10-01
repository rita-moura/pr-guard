import { readFile, appendFile } from 'node:fs/promises';
import { evaluate, hasFailures, validatePolicy } from '../src/engine.js';

export async function checkPullRequest({ event, policy, token, fetchImpl = fetch, apiUrl = 'https://api.github.com' }) {
  validatePolicy(policy);
  if (!event.pull_request || !event.repository?.full_name) throw new Error('Este comando requer um evento de pull request.');
  if (!token) throw new Error('GITHUB_TOKEN ausente.');
  const request = async path => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`API do GitHub: HTTP ${response.status} em ${path}`);
    return response.json();
  };
  const repo = event.repository.full_name;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repositório inválido.');
  const pr = await request(`/repos/${repo}/pulls/${event.pull_request.number}`);
  const context = { channel: 'ci', repository: repo, title: pr.title, body: pr.body ?? '', head: pr.head.ref, base: pr.base.ref };
  let results = evaluate(policy, context);
  if (results.some(result => result.type === 'openspec-archived' && result.status === 'unknown')) {
    const sourceRepo = pr.head.repo?.full_name;
    if (!sourceRepo || !/^[\w.-]+\/[\w.-]+$/.test(sourceRepo) || !/^[a-f0-9]{40}$/.test(pr.head.sha)) throw new Error('Origem do PR indisponível.');
    const tree = await request(`/repos/${sourceRepo}/git/trees/${pr.head.sha}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Árvore de arquivos incompleta; não foi possível verificar OpenSpec.');
    context.paths = tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path);
    results = evaluate(policy, context);
  }
  return results;
}

async function main() {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const policy = JSON.parse(await readFile(new URL('../.github/pr-guard.json', import.meta.url), 'utf8'));
    const results = await checkPullRequest({ event, policy, token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL });
    const lines = results.map(result => `${result.status.toUpperCase()} [${result.severity}] ${result.id}: ${result.detail}`);
    // JSON escapes control characters from PR content, including workflow command newlines.
    for (const line of lines) console.log(JSON.stringify(line));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `<h2>PR Guard</h2><pre>${escapeHtml(lines.join('\n'))}</pre>\n`);
    }
    if (hasFailures(results)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(`PR Guard: ${error.message}`));
    process.exitCode = 1;
  }
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) await main();
