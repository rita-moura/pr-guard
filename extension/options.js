/* global PRGuard, chrome */
const editor = document.querySelector('#policy');
const status = document.querySelector('#status');
const readPolicy = () => PRGuard.validatePolicy(JSON.parse(editor.value));
const toggle = document.querySelector('#enabled');
const enabledStatus = document.querySelector('#enabled-status');
let enabled = true;
function showEnabled(value) {
  enabled = value !== false;
  toggle.setAttribute('aria-checked', String(enabled));
  toggle.textContent = enabled ? 'ON' : 'OFF';
  document.querySelector('#enabled-help').textContent = enabled
    ? 'Ligado somente na aba Conversation dos pull requests.'
    : 'Desligado neste navegador. Suas regras continuam salvas.';
}
chrome.storage.local.get(['policy', 'enabled']).then(data => {
  editor.value = JSON.stringify(data.policy ?? PRGuard.defaults, null, 2);
  showEnabled(data.enabled);
  toggle.disabled = false;
}).catch(error => { enabledStatus.textContent = `Não foi possível carregar: ${error.message}`; });
toggle.addEventListener('click', async () => {
  const next = !enabled;
  toggle.disabled = true;
  try {
    await chrome.storage.local.set({ enabled: next });
    showEnabled(next);
    enabledStatus.textContent = next ? 'PR Guard ligado nos PRs abertos.' : 'PR Guard desligado: painel, alertas e bloqueio local suspensos.';
  } catch (error) { enabledStatus.textContent = `Não foi possível alterar: ${error.message}`; }
  finally { toggle.disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) showEnabled(changes.enabled.newValue);
});
document.querySelector('#save').addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({ policy: readPolicy() });
    status.textContent = 'Regras salvas. Os PRs abertos serão reavaliados.';
  } catch (error) { status.textContent = `Não foi possível salvar: ${error.message}`; }
});
document.querySelector('#import').addEventListener('change', async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 100_000) throw new Error('Arquivo acima de 100 KB.');
    const policy = PRGuard.validatePolicy(JSON.parse(await file.text()));
    editor.value = JSON.stringify(policy, null, 2);
    status.textContent = 'Política importada para edição. Clique em Salvar regras para aplicar.';
  } catch (error) { status.textContent = error.message; }
});
document.querySelector('#export').addEventListener('click', () => {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(readPolicy(), null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pr-guard.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Política exportada. No repositório, salve como .github/pr-guard.json.';
  } catch (error) { status.textContent = error.message; }
});
