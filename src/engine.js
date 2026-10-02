// Shared by the browser extension and the trusted CI runner. No dynamic code.
export const ruleTypes = ['title-prefix', 'body-sections', 'checklist', 'merge-method', 'openspec-archived'];
const methods = ['squash', 'merge', 'rebase'];
const stringList = value => Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 200);

export function validatePolicy(policy) {
  if (!policy || policy.version !== 1 || !Array.isArray(policy.rules) || policy.rules.length > 100) throw new Error('Use version: 1 e até 100 regras.');
  if (policy.blockMerge !== undefined && typeof policy.blockMerge !== 'boolean') throw new Error('blockMerge deve ser true ou false.');
  const ids = new Set();
  for (const rule of policy.rules) {
    if (!rule || typeof rule.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(rule.id) || ids.has(rule.id)) throw new Error('Cada regra precisa de um id único (letras minúsculas, números e hífen).');
    ids.add(rule.id);
    if (!ruleTypes.includes(rule.type)) throw new Error(`Tipo desconhecido: ${rule.type}`);
    if (rule.severity !== undefined && !['error', 'warning'].includes(rule.severity)) throw new Error(`Severidade inválida: ${rule.id}`);
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') throw new Error(`enabled inválido: ${rule.id}`);
    if (rule.message !== undefined && (typeof rule.message !== 'string' || rule.message.length > 1000)) throw new Error(`Mensagem inválida: ${rule.id}`);
    if (rule.when !== undefined) {
      if (!rule.when || typeof rule.when !== 'object' || Array.isArray(rule.when)) throw new Error(`Escopo inválido: ${rule.id}`);
      for (const [key, value] of Object.entries(rule.when)) {
        if (!['repository', 'head', 'base'].includes(key) || !stringList(value)) throw new Error(`Escopo inválido: ${rule.id}.${key}`);
      }
    }
    if (rule.type === 'title-prefix' && !stringList(rule.prefixes)) throw new Error(`Informe prefixes em ${rule.id}.`);
    if (rule.type === 'title-prefix' && rule.requireNumber !== undefined && typeof rule.requireNumber !== 'boolean') throw new Error(`requireNumber inválido: ${rule.id}`);
    if (rule.type === 'body-sections' && !stringList(rule.sections)) throw new Error(`Informe sections em ${rule.id}.`);
    if (rule.type === 'body-sections' && rule.placeholders !== undefined && !stringList(rule.placeholders)) throw new Error(`placeholders inválido: ${rule.id}`);
    if (rule.type === 'merge-method' && !methods.includes(rule.method)) throw new Error(`Método inválido: ${rule.id}`);
  }
  return policy;
}

export function globMatches(pattern, value) {
  // Only '*' is special. All regular-expression characters are escaped.
  const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function cleanMarkdown(body = '') {
  return body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '');
}

export function changeIdFromBody(body = '') {
  return cleanMarkdown(body).match(/^\s*OpenSpec:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/mi)?.[1] ?? null;
}

function sectionsFromBody(body) {
  const sections = new Map();
  let current;
  for (const line of cleanMarkdown(body).split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = heading[1].trim().toLocaleLowerCase('pt-BR');
      if (!sections.has(current)) sections.set(current, '');
    } else if (current) sections.set(current, sections.get(current) + '\n' + line);
  }
  return sections;
}

export function evaluate(policy, context) {
  validatePolicy(policy);
  return policy.rules.filter(rule => rule.enabled !== false).map(rule => {
    const result = (status, detail) => ({ id: rule.id, type: rule.type, severity: rule.severity ?? 'error', status, message: rule.message || detail, detail });
    for (const [key, patterns] of Object.entries(rule.when ?? {})) {
      if (context[key] == null) return result('unknown', `Não foi possível identificar ${key}.`);
      if (!patterns.some(pattern => globMatches(pattern, context[key]))) return result('skip', 'Regra fora do escopo deste PR.');
    }
    if (rule.type === 'title-prefix') {
      if (context.title == null) return result('unknown', 'Título indisponível.');
      // requireNumber: the prefix must be followed by digits, a separator and a description (e.g. "TASK-123 Ajusta X").
      const rest = prefix => context.title.slice(prefix.length);
      const valid = rule.prefixes.some(prefix => context.title.startsWith(prefix) && (rule.requireNumber ? /^\d+[\s:]+\S/.test(rest(prefix)) : rest(prefix).trim()));
      const format = rule.prefixes.map(prefix => rule.requireNumber ? `${prefix}<número>` : prefix).join(' ou ');
      return result(valid ? 'pass' : 'fail', `O título deve começar com ${format} e conter uma descrição.`);
    }
    if (rule.type === 'body-sections') {
      if (context.body == null) return result('unknown', 'Descrição indisponível.');
      const sections = sectionsFromBody(context.body);
      // Lines still containing template example text count as unfilled.
      const filled = text => text.split('\n').filter(line => !(rule.placeholders ?? []).some(p => line.includes(p))).join('\n').trim();
      // "Description|Summary": any of the alternative headings satisfies the section.
      const missing = rule.sections.filter(name => !name.split('|').some(alias => {
        const value = filled(sections.get(alias.trim().toLocaleLowerCase('pt-BR')) ?? '');
        return value && !/^(?:[-\s.]|tbd|todo|preencher|n\/a)*$/i.test(value);
      }));
      return result(missing.length ? 'fail' : 'pass', missing.length ? `Preencha as seções: ${missing.map(name => name.split('|').map(alias => alias.trim()).join(' ou ')).join(', ')}.` : 'Seções obrigatórias preenchidas.');
    }
    if (rule.type === 'checklist') {
      if (context.body == null) return result('unknown', 'Descrição indisponível.');
      const boxes = [...cleanMarkdown(context.body).matchAll(/^\s*[-*]\s+\[([ xX])\]\s+\S/gm)];
      return result(boxes.length > 0 && boxes.every(box => box[1].toLowerCase() === 'x') ? 'pass' : 'fail', 'Inclua e conclua o checklist do PR.');
    }
    if (rule.type === 'merge-method') {
      if (context.channel === 'ci') return result('skip', 'A seleção do botão não está disponível no CI. Restrinja os métodos nas configurações do GitHub.');
      if (!context.mergeMethod) return result('unknown', `Selecione ${rule.method}. O método atual ainda não foi identificado.`);
      return result(context.mergeMethod === rule.method ? 'pass' : 'fail', `Método exigido: ${rule.method}; selecionado: ${context.mergeMethod}.`);
    }
    if (rule.type === 'openspec-archived') {
      if (context.body == null) return result('unknown', 'Descrição indisponível.');
      const id = changeIdFromBody(context.body);
      if (!id) return result('fail', 'Vincule a mudança na descrição: OpenSpec: nome-da-mudanca');
      if (!Array.isArray(context.paths)) return result('unknown', 'Arquivamento OpenSpec precisa ser verificado pelo GitHub Actions.');
      const active = context.paths.some(path => path.startsWith(`openspec/changes/${id}/`));
      const archived = context.paths.some(path => new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${id}/proposal\\.md$`).test(path));
      return result(archived && !active ? 'pass' : 'fail', archived && !active ? `Mudança ${id} arquivada.` : `Arquive a mudança ${id} associada a este PR.`);
    }
  });
}

export const hasFailures = results => results.some(result => result.severity === 'error' && ['fail', 'unknown'].includes(result.status));
