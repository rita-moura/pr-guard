import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { validatePolicy } from '../src/engine.js';
const root = new URL('../', import.meta.url);
const output = new URL('dist/extension/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('extension/', root), output, { recursive: true });
const engine = (await readFile(new URL('src/engine.js', root), 'utf8')).replace(/^export /gm, '');
// New installations start without company rules; users import their own policy.
const policy = validatePolicy({ version: 1, rules: [] });
await writeFile(new URL('engine.js', output), `(() => {\n${engine}\nglobalThis.PRGuard = { evaluate, validatePolicy, hasFailures, defaults: ${JSON.stringify(policy)} };\n})();\n`);
const githubMerge = (await readFile(new URL('src/github-merge.js', root), 'utf8')).replace(/^export /gm, '');
await writeFile(new URL('github-merge.js', output), `(() => {\n${githubMerge}\nglobalThis.PRGuardGitHub = { methodFromButton, selectedMergeMethod };\n})();\n`);
console.log('Extensão pronta em dist/extension');
