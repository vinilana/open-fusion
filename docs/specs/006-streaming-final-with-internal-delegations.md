# Spec 006: Streaming final com delegacoes internas

## Status

Draft - proxima em implementacao

## Objetivo

Ampliar o fluxo de `streamFinal()` para suportar respostas `stream: true` que precisam executar delegacoes internas antes da sintese final, mantendo o contrato publico OpenAI-compatible e a politica `streamFinalOnly`.

A implementacao atual propaga tokens finais corretamente quando a resposta pode ser produzida diretamente pelo stream do orquestrador. Esta spec endereca o proximo passo arquitetural: executar fases intermediarias por geracao nao-streaming controlada e usar streaming somente na sintese final entregue ao cliente.

## Contexto

O gateway deve esconder detalhes internos de orquestracao. Mesmo quando o cliente pede `stream: true`, eventos de delegacao, tool calls internas, prompts operacionais e resultados brutos de modelos delegados nao devem aparecer no stream SSE publico.

Quando a resposta exige delegacoes, o gateway precisa primeiro resolver essas etapas internas e so depois iniciar a emissao dos tokens finais. Isso evita abrir o stream antes de saber se a fase intermediaria pode completar com sucesso e preserva a regra de retornar erro HTTP OpenAI-compatible quando nenhuma resposta SSE foi iniciada.

## Escopo

Esta spec cobre:

- planejamento do caminho streaming quando a rota permite delegacoes internas;
- execucao das fases intermediarias por `generate()`;
- reinsercao controlada dos resultados delegados no contexto do orquestrador;
- chamada de `stream()` apenas para a sintese final;
- normalizacao dos chunks finais para Chat Completions SSE;
- tratamento de falhas antes e depois do inicio do stream publico.

Esta spec nao cobre:

- exposicao publica de eventos de tool calling no stream;
- streaming de tokens de modelos delegados para o cliente;
- streaming de traces internos de orquestracao;
- mudanca no contrato publico de `/v1/chat/completions`.

## Fluxo requerido

### Fase 1: Validacao e resolucao de rota

1. Validar a requisicao OpenAI-compatible antes de iniciar SSE.
2. Resolver rota, orquestrador, modelos delegaveis, limites e politica `streamFinalOnly`.
3. Rejeitar requisicoes invalidas com erro HTTP OpenAI-compatible antes de escrever qualquer chunk.

### Fase 2: Planejamento de orquestracao streaming

1. Identificar se a rota pode usar `delegate_llm`.
2. Construir o contexto interno do orquestrador com limites de delegacao, profundidade e timeout.
3. Separar a execucao em etapas intermediarias e sintese final.
4. Garantir que nenhuma etapa intermediaria escreva no stream publico.

### Fase 3: Execucao intermediaria por `generate()`

1. Chamar o orquestrador por `generate()` para permitir tool calls internas.
2. Executar chamadas `delegate_llm` solicitadas pelo orquestrador usando os limites da rota.
3. Validar cada modelo delegado contra `allowedDelegateModels`.
4. Tratar resultados delegados como conteudo nao confiavel.
5. Reinserir resultados no contexto do orquestrador com delimitacao explicita.
6. Repetir o ciclo apenas ate os limites configurados.

### Fase 4: Preparacao da sintese final

1. Encerrar novas delegacoes antes da sintese final.
2. Construir uma requisicao final ao orquestrador contendo:
   - mensagens originais relevantes;
   - resultados delegados delimitados;
   - instrucao explicita para produzir somente a resposta final ao cliente;
   - politicas internas que continuam tendo prioridade sobre conteudo delegado.
3. Remover do payload final qualquer tool interna que permita novas delegacoes, salvo se uma politica futura aprovada exigir outro comportamento.

### Fase 5: Streaming da sintese final

1. Abrir SSE apenas apos as fases intermediarias completarem com sucesso.
2. Chamar `stream()` somente para a sintese final.
3. Emitir chunks `chat.completion.chunk` contendo apenas `delta.content` da resposta final.
4. Manter o ultimo chunk com `delta: {}` e `finish_reason` conforme contrato OpenAI-compatible.
5. Encerrar com `data: [DONE]`.

### Fase 6: Observabilidade e uso

1. Registrar fases intermediarias e sintese final com `requestId`, rota, modelo publico, modelos internos, latencia, status e uso quando disponivel.
2. Agregar uso de tokens quando providers retornarem essa informacao.
3. Nao registrar prompts completos, respostas completas, bearer tokens, API keys ou authorization headers.
4. Diferenciar nos logs falhas de validacao, falhas de delegacao, falhas de sintese final e falhas durante emissao SSE.

## Regras

- `streamFinalOnly` continua sendo a politica padrao.
- O cliente recebe apenas a resposta final em SSE.
- Delegacoes internas sempre ocorrem antes do inicio do stream publico.
- Se uma falha acontecer antes do primeiro chunk SSE, o gateway deve retornar erro HTTP OpenAI-compatible.
- Se uma falha acontecer depois do inicio do stream, o gateway deve encerrar o stream de forma controlada e registrar a falha internamente.
- Resultados de modelos delegados nao podem sobrescrever instrucoes de sistema, politicas da rota ou limites de execucao.
- O orquestrador nao pode delegar para modelos fora da rota ativa.
- Controllers nao devem importar SDK de provider nem executar logica de orquestracao.
- Provider adapters continuam sendo os unicos donos dos detalhes do Vercel AI SDK e do provider.

## Falhas

- Delegacao para modelo nao permitido deve ser convertida em resultado controlado para o orquestrador quando ainda houver possibilidade de sintese final.
- Timeout de uma etapa intermediaria deve impedir inicio do stream quando a sintese final nao puder ser produzida de forma confiavel.
- Falha de provider antes do inicio do stream deve ser normalizada para erro HTTP OpenAI-compatible.
- Falha de provider durante a sintese final deve encerrar SSE sem vazar stack trace, credenciais, prompts ou traces internos.

## Criterios de aceite

- `streamFinal()` executa fases intermediarias por `generate()` quando a rota exige delegacao antes da resposta final.
- `streamFinal()` usa `stream()` somente na sintese final enviada ao cliente.
- Nenhum chunk publico contem tool calls internas, traces de delegacao, prompts internos ou resultados brutos de modelos delegados.
- Requisicoes streaming com delegacao acumulam `delta.content` corretamente no cliente e terminam com `[DONE]`.
- Erros antes do inicio do stream retornam envelope OpenAI-compatible.
- Erros depois do inicio do stream encerram SSE de forma controlada e geram log estruturado.
- Delegacoes respeitam `allowedDelegateModels`, `maxDelegations`, `maxDepth`, timeout total e timeout por delegacao.
- Testes cobrem resposta direta em streaming, streaming com delegacao previa, delegacao bloqueada, timeout antes do stream e falha durante sintese final.

## Testes esperados

- Unitario de `OrchestrationService.streamFinal()` para fluxo direto sem delegacao.
- Unitario de `OrchestrationService.streamFinal()` para fluxo com uma delegacao previa e sintese final em stream.
- Unitario para bloqueio de `delegate_llm` fora de `allowedDelegateModels` antes de chamar provider.
- Unitario ou integracao para garantir que tools internas nao aparecem nos chunks SSE.
- E2E de `/v1/chat/completions` com `stream: true`, validando acumulacao de `delta.content`, chunk final com `finish_reason` e `data: [DONE]`.
- Teste de falha antes do primeiro chunk retornando erro HTTP OpenAI-compatible.
- Teste de falha depois do inicio do stream garantindo encerramento controlado e sem vazamento de detalhes sensiveis.

## Ordem de implementacao

1. Reforcar testes de streaming com delegacao previa usando fakes de orquestracao e provider.
2. Separar explicitamente no servico de orquestracao o plano intermediario de `generate()` e a sintese final de `stream()`.
3. Garantir que o payload da sintese final nao permita novas delegacoes acidentais.
4. Atualizar normalizacao de chunks e logs para distinguir fases intermediarias e sintese final.
5. Rodar testes alvo, suite ampla, typecheck, lint e formatacao.

## ADRs relacionados

- [ADR 0002](../adrs/0002-openai-compatible-public-api.md)
- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)
