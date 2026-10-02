import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

// The regular build copies the committed PNGs; only icon changes need Chrome.
const root = new URL('../', import.meta.url);
const svg = await readFile(new URL('extension/icons/icon.svg', root));
const temporary = await mkdtemp(join(tmpdir(), 'pr-guard-icons-'));
try {
  const html = join(temporary, 'render.html');
  await writeFile(html, `<!doctype html><pre id="icons"></pre><script>
    const image = new Image();
    image.onload = () => {
      const icons = {};
      for (const size of [16, 32, 48, 128]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        icons[size] = canvas.toDataURL('image/png').split(',')[1];
      }
      document.querySelector('#icons').textContent = JSON.stringify(icons);
    };
    image.src = 'data:image/svg+xml;base64,${svg.toString('base64')}';
  </script>`);
  const child = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${join(temporary, 'profile')}`, '--dump-dom',
    '--virtual-time-budget=2000', pathToFileURL(html).href,
  ]);
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); }
  finally { clearTimeout(timeout); }
  const encoded = stdout.match(/<pre id="icons">([^<]+)<\/pre>/)?.[1];
  if (code !== 0 || !encoded) throw new Error(`Não foi possível renderizar os ícones: ${stderr.slice(-1000)}`);
  const icons = JSON.parse(encoded);
  for (const size of [16, 32, 48, 128]) {
    await writeFile(new URL(`extension/icons/icon${size}.png`, root), Buffer.from(icons[size], 'base64'));
  }
  console.log('Ícones gerados: 16, 32, 48 e 128 px.');
} finally { await rm(temporary, { recursive: true, force: true }); }
