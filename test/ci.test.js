import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPullRequest } from '../scripts/check-pr.mjs';
const event = { repository: { full_name: 'acme/app' }, pull_request: { number: 1 } };
const policy = { version: 1, rules: [{ id: 'openspec', type: 'openspec-archived' }] };
const pr = { title: 'feat: regras', body: 'OpenSpec: add-rules', head: { ref: 'feature/rules', sha: 'a'.repeat(40), repo: { full_name: 'acme/app' } }, base: { ref: 'main' } };
test('CI consulta metadados atuais e árvore sem executar arquivos do PR', async () => {
  const calls = [];
  const results = await checkPullRequest({ event, policy, token: 'test', fetchImpl: async url => {
    calls.push(url);
    return { ok: true, json: async () => calls.length === 1 ? pr : { truncated: false, tree: [{ type: 'blob', path: 'openspec/changes/archive/2026-10-01-add-rules/proposal.md' }] } };
  } });
  assert.equal(results[0].status, 'pass');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/git\/trees\/a{40}\?recursive=1$/);
});
test('CI falha quando árvore é truncada ou API não autoriza', async () => {
  await assert.rejects(checkPullRequest({ event, policy, token: 'test', fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  let count = 0;
  await assert.rejects(checkPullRequest({ event, policy, token: 'test', fetchImpl: async () => ({ ok: true, json: async () => ++count === 1 ? pr : { truncated: true, tree: [] } }) }), /incompleta/);
});
test('regras OpenSpec fora do escopo não buscam árvore', async () => {
  let calls = 0;
  await checkPullRequest({ event, policy: { version: 1, rules: [{ ...policy.rules[0], when: { base: ['release'] } }] }, token: 'test', fetchImpl: async () => { calls++; return { ok: true, json: async () => pr }; } });
  assert.equal(calls, 1);
});
