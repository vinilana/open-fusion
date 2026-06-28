# Revisao critica da implementacao da Spec 007

Data: 2026-06-28
Branch: `spec-007-orchestrator-capability-matching`
PR: https://github.com/vinilana/open-fusion/pull/9

## Escopo

Revisao critica conduzida com quatro agentes independentes:

- orquestracao e aderencia a Spec 007;
- provider adapters e fronteira com Vercel AI SDK;
- seguranca, observabilidade, contrato publico e config;
- testes, spec governance e cobertura contra regressao.

Arquivos de referencia lidos: `docs/PRD.md`, Specs 001, 003, 004, 006, 007 e 008, ADRs 0001, 0003, 0004, 0005 e 0007, codigo em `src/` e testes em `test/`.

## Resultado executivo

A implementacao moveu corretamente o match semantico de capabilities para uma decisao estruturada do orquestrador. Nao foi encontrada heuristica local de keywords, prioridade fixa de capability ou selecao por primeiro delegado no caminho de streaming final.

Mesmo assim, a revisao encontrou riscos relevantes antes de considerar a PR pronta:

- erros publicos pre-SSE ainda podem vazar ids internos, capabilities e detalhes de grafo;
- timeouts usam `Promise.race`, mas nao cancelam chamadas em voo no provider;
- decisoes estruturadas malformadas falham imediatamente, sem tentativa de reparo prevista na Spec 007;
- `finishReason` desconhecido do AI SDK pode virar `stop` e mascarar falha;
- tool calls retornadas pelo provider sao filtradas parcialmente em vez de rejeitadas estritamente;
- metadados internos de delegacao sao inseridos no contexto do modelo final e podem ser ecoados;
- health checks, auditoria global de `/v1/*`, redaction configuravel e script CI ainda estao incompletos.

## Achados priorizados

### P0: Sanitizar erros publicos de roteamento e grafo

Evidencia:

- `src/orchestration/orchestration.service.ts:1040`
- `src/orchestration/orchestration.service.ts:1061`
- `src/errors/openai-error.filter.ts:21`

Impacto: decisoes invalidas antes do primeiro chunk podem retornar mensagens com `worker.*`, capabilities, task ids, route ids ou detalhes de grafo. Isso viola a Spec 007, que impede expor capabilities internas, grafo e metadados de roteamento ao cliente.

Recomendacao: usar mensagens publicas genericas para falhas de roteamento/grafo e manter detalhes internos apenas em logs estruturados.

Status: aplicado nesta rodada.

### P0: Cancelar chamadas de routing e streaming final em timeout

Evidencia:

- `src/orchestration/orchestration.service.ts:259`
- `src/orchestration/orchestration.service.ts:183`
- `src/orchestration/orchestration.service.ts:359`
- `src/orchestration/orchestration.service.ts:1256`

Impacto: o backend retorna timeout, mas a chamada paga pode continuar no provider porque `withTimeout()` so faz `Promise.race`. A porta e o OpenRouter adapter ja aceitam `abortSignal`.

Recomendacao: criar `AbortController` para routing e final streaming; abortar em timeout, erro terminal e fechamento do iterador; adicionar testes que observam `abortSignal.aborted`.

Status: aplicado nesta rodada.

### P0: Implementar reparo estruturado de decisao malformada

Evidencia:

- `src/orchestration/orchestration.service.ts:277`
- `test/llm-orchestration-routing.spec.ts:1004`
- `docs/specs/007-orchestrator-capability-matching.md`

Impacto: a Spec 007 permite uma tentativa de reparo estruturado quando houver budget. O codigo atual falha imediatamente em decisao malformada, inclusive texto contendo JSON.

Recomendacao: fazer uma segunda chamada por `generateRoutingDecision` quando a primeira resposta nao normalizar, ainda dentro do deadline; testar malformada -> valida e malformada -> malformada.

Status: aplicado nesta rodada.

### P1: Tratar `finishReason` desconhecido como falha ou estado explicito

Evidencia:

- `src/providers/openrouter.adapter.ts:470`
- `node_modules/ai/src/types/language-model.ts`

Impacto: `error`, `other` ou `unknown` podem virar `stop`, fazendo falhas ou encerramentos ambiguos parecerem sucesso.

Recomendacao: mapear `error` para `provider_error`; decidir politica explicita para `other`/`unknown`; cobrir generate e stream.

Status: aplicado nesta rodada.

### P1: Validar tool calls de provider estritamente

Evidencia:

- `src/providers/openrouter.adapter.ts:492`
- `src/providers/openrouter.adapter.ts:515`
- `src/providers/openrouter.adapter.ts:593`

Impacto: `depends_on` invalido e campos vazios podem ser silenciosamente filtrados, alterando o grafo proposto pelo provider.

Recomendacao: rejeitar o tool call inteiro quando `target_model`, `task`, `messages`, `depends_on` ou campos opcionais tiverem formato invalido.

Status: aplicado nesta rodada.

### P1: Reduzir metadados internos no contexto do modelo final

Evidencia:

- `src/providers/openrouter.adapter.ts:416`
- `src/orchestration/orchestration.service.ts:192`

Impacto: mesmo sem expor diretamente no SSE, o modelo final recebe `Model`, `Task`, `LatencyMs`, `FinishReason` e `Usage` como mensagem `user`, e pode ecoar isso.

Recomendacao: passar ao modelo final apenas conteudo delegado delimitado e opaco; manter ids, tarefas, latencia e usage em logs.

Status: aplicado nesta rodada.

### P2: Health checks publicos

Evidencia:

- `src/app.module.ts`
- ausencia de `health` em `src/`

Impacto: a Spec 008 recomenda `GET /health/live` e `GET /health/ready`; o projeto nao tem contrato operacional nem teste provando ausencia de chamadas pagas.

Recomendacao: criar `HealthModule` publico com checks locais e e2e.

Status: aplicado nesta rodada.

### P2: Auditoria global de `/v1/*`

Evidencia:

- `src/auth/auth.guard.ts`
- `src/v1/models.controller.ts`

Impacto: falhas de auth e acessos a `/v1/models` recebem `requestId`, mas nao entram no logger operacional de chat/orquestracao.

Recomendacao: interceptor/filtro global para eventos HTTP de `/v1/*`, incluindo falhas de guard, sem headers ou tokens.

Status: aplicado nesta rodada com logs HTTP genericos para falhas globais de `/v1/*` e sucesso de `/v1/models`; o log especifico de chat completions permanece separado.

### P2: Redaction configuravel

Evidencia:

- `src/errors/redact-sensitive.ts`
- `src/config/gateway-config.service.ts`

Impacto: `observability.redact` existe no raw schema, mas nao entra no runtime; redaction segue hard-coded.

Recomendacao: carregar politica no runtime e centralizar redaction de strings/objetos.

Status: aplicado nesta rodada para chaves configuraveis no redactor central e conteudo interno reinserido; logs atuais continuam sem prompts/respostas completos.

### P2: Parser global usa maior payload de todas as rotas

Evidencia:

- `src/http-app.ts`
- `src/config/gateway-config.service.ts:224`

Impacto: uma rota com limite alto aumenta o limite de parser para todas as rotas antes da validacao per-route.

Recomendacao: definir limite global explicito e documentar relacao com limites por rota.

Status: aplicado nesta rodada com `server.maxPayloadBytes` como limite global explicito do parser HTTP.

### P2: Script CI/test:all ausente

Evidencia:

- `package.json`
- ausencia de `.github/workflows`

Impacto: `npm test` nao roda e2e; reviewers ou CI simples podem perder cobertura HTTP/SSE.

Recomendacao: adicionar `test:all` ou `ci` com unit, e2e, typecheck, lint e format.

Status: aplicado nesta rodada com script `npm run ci`.

## Verificacoes positivas

- `streamFinal()` usa `generateRoutingDecision` estruturado.
- Nao foi encontrado parsing de `message.content` para JSON de decisao.
- Capabilities nao canonicas sao aceitas quando declaradas e escolhidas pelo orquestrador.
- Empates de capability respeitam a decisao estruturada.
- Validador mecanico cobre `allowedDelegateModels`, capability declarada, dependencias desconhecidas, ciclos, fallback desabilitado e `maxDelegations`.
- Streaming final nos testes nao emite tool calls/grafo diretamente e termina com `[DONE]`.
- Imports de OpenRouter/Vercel AI SDK ficam isolados em `src/providers/openrouter.adapter.ts`.
- Spec governance esta correta: a Spec 007 foi criada como spec nova e a Spec 006 ficou historica.

## Plano de aplicacao

Aplicado nesta rodada:

1. Sanitizar mensagens publicas de falhas de roteamento/grafo.
2. Implementar repair estruturado limitado a uma tentativa.
3. Cancelar chamadas de routing e final stream por `AbortController`.
4. Corrigir `finishReason` desconhecido e validacao de tool calls no OpenRouter adapter.
5. Reduzir metadados internos enviados ao modelo final.
6. Adicionar testes focados para cada correcao.

Sem follow-up obrigatorio restante desta revisao. Um workflow GitHub Actions pode ser adicionado depois para executar `npm run ci` remotamente, mas o script local ja existe.
