import test from 'node:test';
import assert from 'node:assert/strict';
import { methodFromButton, selectedMergeMethod } from '../src/github-merge.js';

// Snapshot of the properties read from a GitHub merge control.
const button = (textContent, { visible = true, menu = false, value, ...attributes } = {}) => ({
  textContent, value,
  getAttribute: name => attributes[name] ?? null,
  getClientRects: () => visible ? [{}] : [],
  closest: () => menu ? {} : null,
});

test('reconhece as ações de merge e suas confirmações', () => {
  for (const [label, method] of [
    ['Merge pull request', 'merge'], ['Create a merge commit', 'merge'], ['Confirm merge', 'merge'],
    ['Squash and merge', 'squash'], ['Confirm squash and merge', 'squash'], ['Confirm squash', 'squash'],
    ['Rebase and merge', 'rebase'], ['Confirm rebase and merge', 'rebase'], ['Confirm rebase', 'rebase'],
    ['  SQUASH\n and   merge  ', 'squash'],
  ]) assert.equal(methodFromButton(button(label)), method, label);
});

test('usa atributos explícitos e rótulo acessível', () => {
  assert.equal(methodFromButton(button('', { 'data-merge-method': 'squash' })), 'squash');
  assert.equal(methodFromButton(button('', { value: 'rebase' })), 'rebase');
  assert.equal(methodFromButton(button('', { 'aria-label': 'Merge pull request' })), 'merge');
  assert.equal(methodFromButton(button('Merge pull request', { 'data-merge-method': 'invalid' })), 'merge');
});

test('não interpreta outros controles como uma ação de merge', () => {
  for (const label of ['Enable auto-merge', 'Disable auto-merge', 'Select merge method', 'Do not confirm merge', '']) {
    assert.equal(methodFromButton(button(label)), undefined);
  }
  assert.equal(methodFromButton(null), undefined);
});

test('abrir o menu não altera o método selecionado', () => {
  const option = button('Create a merge commit', { menu: true, 'data-merge-method': 'merge' });
  assert.equal(methodFromButton(option), undefined);
  assert.equal(selectedMergeMethod([option, button('Squash and merge')]), 'squash');
});

test('ignora botões ocultos e reconhece controles repetidos do mesmo método', () => {
  assert.equal(selectedMergeMethod([button('Merge pull request', { visible: false }), button('Squash and merge')]), 'squash');
  assert.equal(selectedMergeMethod([button('Rebase and merge'), button('Rebase and merge')]), 'rebase');
});

test('confirmação tem prioridade sobre ações ainda visíveis', () => {
  assert.equal(selectedMergeMethod([button('Merge pull request'), button('Confirm squash and merge')]), 'squash');
  assert.equal(selectedMergeMethod([button('Merge pull request'), button('', { 'aria-label': 'Confirm rebase and merge' })]), 'rebase');
});

test('ausência e controles conflitantes deixam o método desconhecido', () => {
  assert.equal(selectedMergeMethod([]), undefined);
  assert.equal(selectedMergeMethod([button('Merge pull request'), button('Squash and merge')]), undefined);
  assert.equal(selectedMergeMethod([button('Confirm merge'), button('Confirm rebase')]), undefined);
});
