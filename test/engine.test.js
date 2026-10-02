import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, hasFailures, validatePolicy, globMatches, changeIdFromBody } from '../src/engine.js';
const run = (rule, context = {}) => evaluate({ version: 1, rules: [{ id: 'test', ...rule }] }, context)[0];

test('título exige prefixo e conteúdo', () => {
  const rule = { type: 'title-prefix', prefixes: ['feat:'] };
  assert.equal(run(rule, { title: 'feat:' }).status, 'fail');
  assert.equal(run(rule, { title: 'feat: adicionar regras' }).status, 'pass');
  assert.equal(run(rule, {}).status, 'unknown');
});
test('título com requireNumber aceita somente número após o prefixo', () => {
  const rule = { type: 'title-prefix', prefixes: ['TASK-'], requireNumber: true };
  for (const title of ['TASK-abc Ajusta X', 'TASK-12abc Ajusta X', 'TASK-123', 'TASK- 123 Ajusta X', 'TASK-Ajusta X']) assert.equal(run(rule, { title }).status, 'fail', title);
  for (const title of ['TASK-123 Ajusta X', 'TASK-7840: Adiciona CSP']) assert.equal(run(rule, { title }).status, 'pass', title);
  assert.throws(() => validatePolicy({ version: 1, rules: [{ id: 'x', ...rule, requireNumber: 'sim' }] }));
});
test('seções vazias, placeholders e comentários não passam', () => {
  const rule = { type: 'body-sections', sections: ['Objetivo', 'Como testar'] };
  assert.equal(run(rule, { body: '## Objetivo\n<!-- conteúdo -->\n## Como testar\nTODO' }).status, 'fail');
  assert.equal(run(rule, { body: '## Objetivo\nAdicionar regras\n## Como testar\nnpm test' }).status, 'pass');
  assert.equal(run(rule, { body: '```md\n## Objetivo\ntexto\n## Como testar\ntexto\n```' }).status, 'fail');
});
test('seções com texto de exemplo do template não passam', () => {
  const rule = { type: 'body-sections', sections: ['Description'], placeholders: ['[Provide a brief description'] };
  assert.equal(run(rule, { body: '## Description\n[Provide a brief description of the changes introduced by this PR]' }).status, 'fail');
  assert.equal(run(rule, { body: '## Description\nAtualiza a política de segurança' }).status, 'pass');
  assert.throws(() => validatePolicy({ version: 1, rules: [{ id: 'x', ...rule, placeholders: [] }] }));
  const alias = { type: 'body-sections', sections: ['Description|Summary'] };
  assert.equal(run(alias, { body: '## Summary\nAdiciona CSP' }).status, 'pass');
  assert.equal(run(alias, { body: '## Description\nAdiciona CSP' }).status, 'pass');
  assert.match(run(alias, { body: '## Notes\nx' }).detail, /Description ou Summary/);
});
test('checklist exige itens presentes e todos concluídos', () => {
  const rule = { type: 'checklist' };
  for (const body of ['', '- [ ] Testes', '- [x] Feito\n- [ ] Pendente']) assert.equal(run(rule, { body }).status, 'fail');
  assert.equal(run(rule, { body: '- [x] Testes\n- [X] Docs' }).status, 'pass');
});
test('escopo por repositório e branches', () => {
  const rule = { type: 'merge-method', method: 'squash', when: { repository: ['acme/*'], head: ['feature/*'], base: ['main'] } };
  assert.equal(run(rule, { repository: 'other/app' }).status, 'skip');
  assert.equal(run(rule, { repository: 'acme/app' }).status, 'unknown');
  assert.equal(run(rule, { repository: 'acme/app', head: 'feature/a', base: 'main', mergeMethod: 'merge' }).status, 'fail');
  assert.equal(run(rule, { repository: 'acme/app', head: 'feature/a', base: 'main', mergeMethod: 'squash' }).status, 'pass');
  assert.equal(globMatches('fix/a.b', 'fix/axb'), false);
});
test('merge sem seleção fica pendente e CI não promete validar botão', () => {
  const rule = { type: 'merge-method', method: 'squash' };
  assert.equal(run(rule, {}).status, 'unknown');
  assert.equal(run(rule, { channel: 'ci' }).status, 'skip');
});
test('OpenSpec valida somente a mudança vinculada e rejeita ativo coexistente', () => {
  const rule = { type: 'openspec-archived' };
  const body = 'OpenSpec: add-rules';
  assert.equal(run(rule, { body: '' }).status, 'fail');
  assert.equal(run(rule, { body }).status, 'unknown');
  assert.equal(run(rule, { body, paths: ['openspec/changes/archive/2026-10-01-other/proposal.md'] }).status, 'fail');
  const paths = ['openspec/changes/archive/2026-10-01-add-rules/proposal.md', 'openspec/changes/other/proposal.md'];
  assert.equal(run(rule, { body, paths }).status, 'pass');
  assert.equal(run(rule, { body, paths: [...paths, 'openspec/changes/add-rules/tasks.md'] }).status, 'fail');
  assert.equal(changeIdFromBody('<!-- OpenSpec: fake -->'), null);
  assert.equal(changeIdFromBody('OpenSpec: ../../secret'), null);
});
test('política inválida é rejeitada e regras desativadas são ignoradas', () => {
  for (const policy of [{ version: 2, rules: [] }, { version: 1, rules: [{ id: 'x', type: 'unknown' }] }, { version: 1, rules: [{ id: 'x', type: 'checklist', when: { typo: ['*'] } }] }]) assert.throws(() => validatePolicy(policy));
  assert.throws(() => validatePolicy({ version: 1, blockMerge: 'sim', rules: [] }));
  assert.doesNotThrow(() => validatePolicy({ version: 1, blockMerge: true, rules: [] }));
  assert.deepEqual(evaluate({ version: 1, rules: [{ id: 'x', type: 'checklist', enabled: false }] }, {}), []);
});
test('avisos não bloqueiam; erros e resultados desconhecidos bloqueiam', () => {
  assert.equal(hasFailures([{ severity: 'warning', status: 'fail' }]), false);
  assert.equal(hasFailures([{ severity: 'error', status: 'unknown' }]), true);
  assert.equal(hasFailures([{ severity: 'error', status: 'skip' }]), false);
});
