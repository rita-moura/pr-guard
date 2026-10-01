const methods = ['squash', 'merge', 'rebase'];
const labels = new Map([
  ['merge pull request', 'merge'],
  ['create a merge commit', 'merge'],
  ['confirm merge', 'merge'],
  ['squash and merge', 'squash'],
  ['confirm squash and merge', 'squash'],
  ['confirm squash', 'squash'],
  ['rebase and merge', 'rebase'],
  ['confirm rebase and merge', 'rebase'],
  ['confirm rebase', 'rebase'],
]);
const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function methodFromButton(button) {
  if (!button) return undefined;
  // Menu entries describe available methods, not the current merge action.
  if (button.closest('[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="listbox"], [role="option"]')) return undefined;
  const value = button.getAttribute('data-merge-method') || button.value;
  if (methods.includes(value)) return value;
  return labels.get(normalize(button.textContent)) || labels.get(normalize(button.getAttribute('aria-label')));
}

export function selectedMergeMethod(buttons) {
  const visible = [...buttons].filter(button => button.getClientRects().length > 0);
  const candidates = visible.filter(button => methodFromButton(button));
  const confirmations = candidates.filter(button =>
    [button.textContent, button.getAttribute('aria-label')].some(label => /^confirm\b/.test(normalize(label))));
  const selected = new Set((confirmations.length ? confirmations : candidates).map(methodFromButton));
  // Conflicting controls can coexist while GitHub updates the page.
  return selected.size === 1 ? [...selected][0] : undefined;
}
