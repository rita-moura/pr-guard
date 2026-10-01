# PR Guard

Extensão de navegador e validador de políticas para padronizar pull requests no GitHub.
Versão inicial **0.1.0**, para Chrome/Edge (Manifest V3), com interface em português.

## O que já funciona

- Editor de regras JSON, com validação, importação e exportação.
- Escopo por repositório, branch de origem e destino; `*` funciona como curinga.
- Validação de prefixo do título, seções preenchidas da descrição e checklist.
- Aviso quando o método de merge identificado difere do configurado.
- Verificação no Actions do arquivamento da mudança OpenSpec vinculada ao PR.
- Motor compartilhado entre extensão e CI, sem dependências de execução.

## Executar e instalar

Requer Node.js 20 ou superior.

```sh
npm test
npm run build
```

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative o modo de desenvolvedor e escolha **Carregar sem compactação**.
3. Selecione a pasta `dist/extension`.
4. Abra um PR no GitHub. O painel PR Guard aparece no canto inferior direito.
5. Clique no ícone da extensão para editar as regras.

Depois de alterar o código: rode o build, recarregue a extensão e a página do PR.
Para validar a seleção de merge, siga o [roteiro de teste manual](docs/TESTE-MANUAL.md).
O painel distingue pendências de verificações não realizadas; controles de merge
ambíguos ou ausentes não são tratados como aprovação.
A extensão não precisa de token, não envia dados para serviços externos e armazena
a configuração somente no navegador, com `chrome.storage.local`.

## Configurar a política da empresa

Comece por [policy.example.json](policy.example.json). A configuração local da extensão
e o arquivo `.github/pr-guard.json` do CI são independentes nesta versão: importe/exporte
o mesmo arquivo para mantê-los alinhados. Sincronização automática ainda não existe.

```json
{
  "version": 1,
  "rules": [
    {
      "id": "squash-features",
      "type": "merge-method",
      "when": {
        "repository": ["minha-empresa/*"],
        "head": ["feature/*", "fix/*"],
        "base": ["main"]
      },
      "method": "squash",
      "severity": "error",
      "message": "Use Squash and merge para entregar uma feature."
    }
  ]
}
```

| Campo | Uso |
| --- | --- |
| `id` | Identificador único, com letras minúsculas, números e hífen |
| `type` | Tipo da verificação |
| `enabled` | `false` desativa; omitido significa ativo |
| `severity` | `error` falha o CI; `warning` orienta sem falhar |
| `when` | Filtros opcionais: `repository`, `head`, `base`, cada um com lista de padrões |
| `message` | Orientação personalizada opcional |

| Tipo | Campos específicos | Critério |
| --- | --- | --- |
| `title-prefix` | `prefixes` | Um prefixo permitido e uma descrição não vazia |
| `body-sections` | `sections` | Títulos Markdown e conteúdo, desconsiderando comentários e blocos de código cercados |
| `checklist` | — | Ao menos um item e todos os itens marcados |
| `merge-method` | `method`: `squash`, `merge` ou `rebase` | Método reconhecido na interface |
| `openspec-archived` | — | Mudança vinculada arquivada e ausente da pasta ativa |

Resultados: `pass`, `fail`, `unknown` (não foi possível verificar) e `skip` (fora do escopo).
O CI falha para `fail`/`unknown` de severidade `error`; nunca assume aprovação quando faltam dados.

## OpenSpec

A regra começa desativada. Quando o fluxo exigir arquivamento **antes do merge**, ative-a
e inclua na descrição uma linha fora de comentários/blocos de código:

```text
OpenSpec: nome-da-mudanca
```

O Actions inspeciona a árvore do commit de origem e procura
`openspec/changes/archive/AAAA-MM-DD-nome-da-mudanca/proposal.md`, exigindo também a ausência
de arquivos em `openspec/changes/nome-da-mudanca/`. Outras mudanças ativas não interferem.
Árvores truncadas ou acesso negado geram falha explícita.

Esta verificação confirma a localização dos artefatos; **não comprova** que todas as tarefas
foram realizadas nem que as especificações principais foram sincronizadas corretamente.
Não executa o CLI OpenSpec nem modifica arquivos. Empresas que arquivam depois do merge devem
manter essa regra desativada para o PR e implementar a cobrança na etapa apropriada.

## GitHub Actions

- `CI`: executa testes e build em pushes para `main` e em PRs.
- `PR Guard`: avalia título, descrição, checklist e OpenSpec em eventos de PR, incluindo edição.

O workflow de política usa `pull_request_target` com permissões somente de leitura e faz
checkout explícito do commit da **base**. Executa apenas o validador e a política confiáveis;
dados do PR são lidos pela API. Nunca faça checkout/execute código da origem nesse workflow.
Uma mudança de política passa a valer depois de integrada à base.

Para impor bloqueio, configure os checks exigidos nas proteções/rulesets do repositório e
verifique o comportamento em um PR de teste. A instalação dos workflows sozinha não ativa
proteções. Disponibilidade depende do plano e da visibilidade do repositório.
Para projetos com merge queue, a integração com `merge_group` ainda precisa ser implementada.

A escolha do botão de merge não é informada ao Actions: a regra `merge-method` é ignorada
explicitamente no CI. Use os métodos permitidos do GitHub para impor essa restrição no servidor.

## Limites desta versão

- Extensão orientativa, sem bloqueio de merge no servidor e sem alterar configurações do GitHub.
- Adaptador inicial para páginas de PR existentes no github.com, com botões em inglês.
  A tela de criação de PR, GitHub Enterprise e variações do layout ainda precisam de suporte.
- Seletores podem mudar com a interface do GitHub; dados ausentes aparecem como pendentes.
- Editor JSON inicial; construtor visual de regras e políticas centrais ficam para as próximas versões.
- Campos desconhecidos adicionais não criam verificações novas; novos tipos exigem implementação no motor.
- Não usa IA para avaliar a qualidade subjetiva de uma descrição.

## Estrutura

```text
extension/             Interface e integração com a página do GitHub
src/engine.js          Motor compartilhado de regras
scripts/build.mjs      Geração da extensão instalável
scripts/check-pr.mjs   Adaptador do GitHub Actions
test/                  Testes de políticas e integração simulada da API
.github/               Política do projeto, template e workflows
docs/ROADMAP.md         Próximas etapas
```

## Referências

- [Content scripts do Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Rulesets do GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Segurança de pull_request_target](https://docs.github.com/en/actions/reference/security/secure-use)
- [Conceitos de arquivamento OpenSpec](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md)

Projeto privado. Nenhuma licença de redistribuição foi concedida nesta versão.
