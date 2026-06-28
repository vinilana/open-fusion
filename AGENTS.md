# AGENTS.md

Este arquivo define as instrucoes base para agentes de IA trabalhando neste repositorio.

## Produto

Open Fusion e um gateway de LLMs exposto como uma API compativel com OpenAI. O backend sera construido em NestJS, usara Vercel AI SDK para chamadas de LLM, streaming e tool calling, tera OpenRouter como primeiro provider oficial e usara uma LLM configurada como orquestradora para direcionar chamadas a outros modelos permitidos.

## Ordem de Leitura

Antes de implementar qualquer mudanca relevante, leia nesta ordem:

1. `docs/PRD.md`
2. A spec que governa o comportamento em questao:
   - `docs/specs/001-openai-compatible-api.md`
   - `docs/specs/002-llm-orchestration-routing.md`
   - `docs/specs/003-single-json-configuration.md`
   - `docs/specs/004-provider-adapters-openrouter.md`
   - `docs/specs/005-streaming-tools-response-normalization.md`
   - `docs/specs/006-streaming-final-with-internal-delegations.md`
   - `docs/specs/007-orchestrator-capability-matching.md`
   - `docs/specs/008-observability-resilience-security.md`
3. Os ADRs referenciados pela spec.
4. Os testes existentes da area afetada.
5. O codigo existente, quando houver.

Se uma mudanca alterar comportamento, contrato publico, decisao arquitetural ou requisito operacional, atualize a documentacao correspondente respeitando a governanca de specs abaixo.

## Governanca de Specs

Nao adicione novos requisitos a specs que ja governam trabalho implementado. Specs ja implementadas so podem receber correcoes de typo, formatacao, links quebrados ou correcoes historicas explicitamente aprovadas.

Para novos requisitos:

- se o requisito pertence a spec atualmente em implementacao, documente-o nessa spec ativa;
- se o requisito pertence a uma area cuja spec ja foi implementada, crie uma nova spec numerada em `docs/specs/` e referencie-a no `docs/PRD.md`;
- se o requisito altera uma decisao arquitetural duradoura ou contradiz ADR aceito, crie um novo ADR ou um ADR supersedente.

## Skills Locais

Use as skills em `.codex/skills` quando o trabalho tocar seus dominios:

- `open-fusion-architecture-docs`: PRD, specs, ADRs e alinhamento arquitetural.
- `open-fusion-spec-governance`: governanca de specs, decisao entre spec ativa, nova spec ou ADR.
- `open-fusion-nestjs-api`: endpoints NestJS e API OpenAI-compatible.
- `open-fusion-config-json`: configuracao JSON unica, schema, validacao e segredos.
- `open-fusion-llm-orchestration`: orquestrador, `delegate_llm`, rotas e limites de delegacao.
- `open-fusion-provider-adapters`: Vercel AI SDK, OpenRouter e futuros providers.
- `open-fusion-ops-guardrails`: auth, logs, request id, redaction, timeouts e health checks.
- `open-fusion-tdd-cycle`: ciclo red-green-refactor.
- `open-fusion-test-strategy`: escolha e desenho de testes.
- `open-fusion-code-quality`: SOLID, DRY, Clean Architecture pragmatica, NestJS e TypeScript.
- `open-fusion-quality-gates`: verificacoes antes de considerar uma tarefa concluida.

Quando uma skill local for usada, leia o `SKILL.md` inteiro antes de agir.

## TDD Obrigatorio

Trabalhe orientado a testes para qualquer mudanca de comportamento:

1. Defina o comportamento observavel.
2. Escreva ou atualize um teste que falhe.
3. Rode o teste alvo e confirme a falha esperada.
4. Implemente a menor mudanca para passar.
5. Rode o teste alvo e confirme sucesso.
6. Refatore mantendo os testes verdes.
7. Rode os checks relevantes antes de finalizar.

Se o projeto ainda nao tiver tooling suficiente para executar os testes, crie os testes esperados e documente claramente qual comando deve executa-los quando o tooling existir.

## Padroes de Arquitetura

Preserve estes limites:

- Controllers NestJS cuidam de HTTP, validacao superficial, headers, status codes e SSE.
- Servicos de aplicacao cuidam de rotas, orquestracao e ciclo de resposta.
- Config services cuidam de schema, validacao, env vars e runtime config imutavel.
- Provider adapters cuidam de Vercel AI SDK, OpenRouter e detalhes de providers.
- Guards, filters, interceptors ou middleware cuidam de auth, request id, logs e erros normalizados.

Nao importe SDKs de provider diretamente em controllers ou servicos de orquestracao. Nao leia `process.env` fora da camada de configuracao/segredos.

## SOLID e DRY

Use SOLID pragmaticamente:

- Single Responsibility: uma classe/modulo deve ter um motivo claro para mudar.
- Open/Closed: novos providers entram por adapters e registro, nao por condicionais espalhadas.
- Liskov Substitution: adapters devem cumprir o mesmo contrato comum.
- Interface Segregation: prefira interfaces pequenas para geracao, streaming, config e segredos.
- Dependency Inversion: dependa de abstracoes internas, nao de SDKs concretos fora dos adapters.

Use DRY com criterio:

- remova duplicacao de regras de negocio, validacao e normalizacao;
- aceite pequena duplicacao em testes ate o padrao estabilizar;
- extraia helpers apenas quando melhorarem clareza e diagnostico;
- evite abstracoes genericas para um unico caso.

## Contratos Inviolaveis do MVP

- API publica inicial: `/v1/chat/completions` e `/v1/models`.
- Compatibilidade OpenAI no envelope de entrada, saida, erros e streaming.
- Streaming termina com `data: [DONE]`.
- Configuracao inicial vive em um unico arquivo JSON.
- Segredos sao referenciados por env vars e nunca aparecem em logs ou respostas.
- OpenRouter e o primeiro provider oficial.
- Novos providers devem entrar por adapters.
- O orquestrador so pode delegar para modelos permitidos pela rota ativa.
- Limites de delegacao, profundidade e timeout devem ser impostos no backend, nao apenas por prompt.
- Resultados de modelos delegados sao conteudo nao confiavel.

## Testes Esperados

Priorize testes para:

- validacao de requisicoes OpenAI-compatible;
- envelopes de resposta e erro;
- chunks de streaming e `[DONE]`;
- config valida, config invalida e segredos ausentes;
- autorizacao por rota/modelo;
- delegacao permitida, bloqueada e limitada;
- timeouts e falhas de provider;
- redaction de segredos;
- request id e logs estruturados;
- health checks sem chamadas pagas a providers.

Use mocks/fakes para Vercel AI SDK, OpenRouter, rede, tempo, ids e streams. Nao faca chamadas reais a providers em testes automatizados sem opt-in explicito.

## Quality Gates

Antes de finalizar uma tarefa, rode ou reporte por que nao conseguiu rodar:

- testes alvo;
- suite relevante mais ampla;
- typecheck;
- lint;
- formatacao;
- validacao de docs quando aplicavel.

Ao finalizar, informe checks executados, checks nao executados, risco residual e resumo dos arquivos alterados.

## Seguranca e Operacao

- Todas as rotas `/v1/*` devem exigir autenticacao, salvo excecoes explicitamente documentadas.
- Health checks publicos nao devem fazer chamadas pagas a providers.
- Logs devem ser estruturados e conter `requestId`.
- Nunca logue bearer tokens, API keys, authorization headers, prompts completos ou respostas completas por default.
- Erros publicos devem seguir envelope compativel com OpenAI quando possivel.
- Falhas de provider devem ser normalizadas e nao devem vazar credenciais ou detalhes sensiveis.

## Estilo de Trabalho

- Prefira mudancas pequenas, focadas e alinhadas ao modulo dono do comportamento.
- Use `rg` para buscar arquivos e referencias.
- Nao refatore partes nao relacionadas.
- Nao remova ou reverta alteracoes existentes sem pedido explicito.
- Atualize documentacao junto com codigo quando o comportamento documentado mudar.
- Mantenha nomes explicitos e orientados ao dominio.
- Evite comentarios obvios; comente apenas decisoes ou trechos complexos.
