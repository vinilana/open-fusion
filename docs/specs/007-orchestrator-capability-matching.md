# Spec 007: Match de capabilities pelo orquestrador

## Status

Draft

## Objetivo

Mover o match entre intencao da requisicao, capabilities declaradas e modelos delegaveis para a LLM orquestradora.

O backend deixa de classificar semanticamente a requisicao por codigo para escolher capabilities ou modelos. Ele continua responsavel por resolver a rota publica, limitar o catalogo de modelos exposto ao orquestrador, validar mecanicamente a decisao retornada, impor autorizacao, limites, timeouts, profundidade, grafo interno e normalizacao da resposta publica.

## Contexto

A [Spec 006](./006-streaming-final-with-internal-delegations.md) implementou routed streaming com classificacao deterministica por codigo (`plan`, `code`, `review`, `design`, `general`) e enforcement do alvo final a partir dessa classificacao.

Esse comportamento protegeu o MVP contra escolhas invalidas, mas coloca a semantica de roteamento no backend. A direcao do produto e que a LLM orquestradora faca o match de capabilities a partir do contexto da requisicao e do catalogo permitido pela rota, enquanto o backend aplica apenas guardrails verificaveis.

Esta spec governa a mudanca incremental apos a Spec 006. Ela nao reescreve a Spec 006 historica; define o novo comportamento esperado antes da implementacao de observabilidade da Spec 008.

## Termos

- Capability declarada: string configurada em um modelo delegado para descrever usos, especialidades ou restricoes daquele modelo.
- Match de capability: decisao semantica que relaciona a requisicao atual a uma ou mais capabilities declaradas por modelos permitidos.
- Decisao de roteamento: saida estruturada do orquestrador indicando alvo final, tasks internas opcionais, dependencies e justificativa operacional.
- Validacao mecanica: checagem feita pelo backend sem interpretar a intencao do usuario, como confirmar que o modelo existe, esta permitido na rota e declara a capability escolhida pelo orquestrador.
- `orchestrator_fallback`: alvo final explicito que usa o modelo orquestrador da rota quando a propria decisao de roteamento indicar que nenhum delegado permitido e adequado e `allowOrchestratorFallback` nao estiver desabilitado pela rota.

## Principios

- Capabilities sao insumos para o orquestrador, nao uma arvore de decisao hardcoded no backend.
- O backend nao deve manter mapas de palavras-chave, prioridades fixas de capability, classificadores locais ou selecao por primeira ocorrencia para decidir o match semantico da requisicao.
- O backend pode validar se a capability escolhida pelo orquestrador existe na lista declarada do modelo escolhido. Essa validacao e mecanica e nao substitui o match semantico.
- O orquestrador deve receber somente modelos delegaveis permitidos pela rota ativa e somente metadados internos necessarios para roteamento.
- O cliente nunca recebe capabilities internas, razoes de roteamento, tool calls, grafo interno, prompts operacionais ou resultados delegados brutos.
- Seguranca, autorizacao e limites continuam no backend; prompt do orquestrador nunca e fronteira de seguranca.

## Catalogo exposto ao orquestrador

Antes de chamar o orquestrador para roteamento, o backend deve montar um catalogo da rota contendo:

- modelo orquestrador da rota;
- modelos em `allowedDelegateModels`;
- capabilities declaradas por cada delegado;
- limites da rota (`maxDelegations`, `maxDepth`, `timeoutMs`, `delegateTimeoutMs`);
- politica de streaming final;
- politica `allowOrchestratorFallback` para indicar se a rota permite `orchestrator_fallback`; campo ausente equivale a `true`;
- restricoes de seguranca e formato esperado para a decisao.

O catalogo nao deve incluir provider API keys, bearer tokens, headers sensiveis, provider model ids quando nao forem necessarios para a decisao, ou modelos que nao estejam permitidos na rota ativa.

## Contrato da decisao de roteamento

O orquestrador deve produzir uma decisao estruturada antes da abertura do SSE publico. Essa decisao deve chegar ao servico de orquestracao como um objeto JSON validado pelo contrato interno, nao como texto contendo JSON.

A implementacao deve usar uma das duas formas, nesta ordem de preferencia:

1. chamada de objeto estruturado do Vercel AI SDK, com schema runtime da decisao de roteamento e retorno ja materializado como objeto;
2. tool call interna obrigatoria para uma tool de decisao de roteamento, com schema de argumentos e `tool_choice` equivalente a escolha forcada quando o provider/modelo nao suportar objeto estruturado direto.

Nao e aceitavel implementar essa etapa pedindo ao modelo para "responder apenas JSON" e depois extrair JSON de `message.content`, markdown, code fence, texto livre ou substring. Se o provider retornar texto contendo JSON em vez de objeto/tool arguments validos, a decisao deve ser tratada como malformada.

O objeto validado precisa representar:

```json
{
  "final_target": {
    "type": "delegate",
    "target_model": "worker.code",
    "matched_capability": "code",
    "reason": "The selected delegate is the best allowed match for the request."
  },
  "pre_final_tasks": [
    {
      "task_id": "review-plan",
      "target_model": "worker.review",
      "matched_capability": "review",
      "task": "Review the proposed implementation approach.",
      "depends_on": []
    }
  ]
}
```

Regras do contrato:

- `final_target.type` deve ser `delegate` ou `orchestrator_fallback`.
- Quando `type` for `delegate`, `target_model` e `matched_capability` sao obrigatorios.
- `matched_capability` deve existir nas capabilities declaradas do `target_model`.
- `pre_final_tasks`, quando existirem, tambem devem indicar `target_model`, `matched_capability`, `task_id`, `task` e dependencies validas.
- `reason` e metadados de diagnostico sao internos e nao podem ser enviados ao cliente por default.
- `orchestrator_fallback` deve ser uma escolha explicita do orquestrador e so pode ser aceito quando `allowOrchestratorFallback` estiver habilitado na rota. A ausencia desse campo na configuracao da rota habilita fallback por default.
- campos desconhecidos, tipos incorretos, arrays fora de limite, strings vazias em campos obrigatorios ou `depends_on` nao resolvivel devem invalidar a decisao antes de qualquer provider call delegada.

## Onde tratar a resposta estruturada

A garantia de JSON estruturado pertence a camada de orquestracao e aos provider adapters:

- o servico de orquestracao define o schema interno da decisao e solicita uma chamada nao-streaming de roteamento estruturado;
- a porta interna de geracao deve expor uma operacao propria para obter objeto estruturado ou tool arguments validados, sem vazar detalhes do SDK para controllers;
- provider adapters traduzem essa operacao para as primitives suportadas pelo Vercel AI SDK e pelo provider ativo, como objeto estruturado, JSON schema ou tool call forcada;
- o servico de orquestracao valida novamente o objeto retornado contra o schema interno antes de normalizar o grafo;
- controllers continuam responsaveis apenas por HTTP, status codes e SSE, sem parsear JSON de respostas de modelo.

Parsing de texto livre, regex, remocao de code fences ou `JSON.parse` sobre conteudo natural do assistant nao devem existir no caminho principal de roteamento. `JSON.parse` so pode ser usado em adaptadores quando o contrato do provider documentar que o campo recebido e payload JSON estrutural, nao texto gerado para usuario.

## Fluxo obrigatorio

### Fase 1: Resolucao da rota

1. Validar a requisicao OpenAI-compatible.
2. Resolver a rota publica, o orquestrador, os delegados permitidos e limites.
3. Validar que todos os delegados referenciados pela rota existem, tem role `delegate` e possuem lista de capabilities bem formada.
4. Nao rejeitar uma rota apenas por falta de uma capability canonica especifica, como `general`, salvo se outra politica ativa da rota exigir isso explicitamente.

### Fase 2: Roteamento pelo orquestrador

1. Chamar a LLM orquestradora com o catalogo permitido da rota e a requisicao do usuario em modo de saida estruturada nao-streaming.
2. Solicitar uma decisao estruturada de match de capabilities, alvo final e tasks internas opcionais por schema de objeto ou tool call obrigatoria.
3. Materializar a resposta como objeto interno validado; texto contendo JSON deve ser rejeitado como decisao malformada.
4. Nao executar heuristica local de capability antes ou depois da decisao do orquestrador.
5. Se a resposta for ambigua, invalida ou vier como texto em vez de objeto, o backend pode solicitar reparo ao orquestrador dentro do budget da requisicao, tambem em modo estruturado.
6. Se ainda nao houver decisao valida, falhar antes de abrir SSE.

### Fase 3: Validacao mecanica e enforcement

1. Validar que cada `target_model` existe em `allowedDelegateModels`.
2. Validar que cada `matched_capability` foi declarada pelo modelo escolhido.
3. Validar grafo aciclico, dependencies resolvidas, exatamente um alvo final, ausencia de recursao e limites de delegacao.
4. Validar `maxDepth`, `maxDelegations`, timeout total e timeout por delegacao.
5. Bloquear modelos nao autorizados, capabilities nao declaradas, tasks sem contrato valido e multiplos alvos finais antes de qualquer provider call.
6. Nao corrigir automaticamente o alvo para outro modelo com base em classificacao local. Correcao deve vir de nova decisao do orquestrador ou resultar em erro controlado.

### Fase 4: Execucao interna

1. Executar tasks pre-final validadas em ordem de dependency.
2. Permitir paralelismo apenas quando o grafo validado provar independencia.
3. Tratar resultados delegados como conteudo nao confiavel.
4. Inserir resultados internos no contexto do alvo final com delimitacao clara.
5. Manter o stream publico fechado ate que o alvo final esteja autorizado e pronto para streaming.

### Fase 5: Streaming final

1. Abrir SSE somente depois da decisao do orquestrador e da validacao mecanica completa.
2. Fazer `stream()` no delegado escolhido quando o alvo final for `delegate`.
3. Fazer `stream()` no orquestrador da rota somente quando o alvo final for `orchestrator_fallback`.
4. Emitir apenas chunks OpenAI-compatible da resposta final.
5. Encerrar com `data: [DONE]`.

## Regras

- O match de capability e responsabilidade do orquestrador.
- O backend nao deve manter uma lista canonica obrigatoria de capabilities para decidir roteamento semantico.
- Capabilities fora de `plan`, `code`, `review`, `design` e `general` podem participar do roteamento quando declaradas na configuracao e escolhidas pelo orquestrador.
- `general` e apenas uma capability declarada como qualquer outra; nao deve ser requisito universal de boot para routed streaming, salvo politica explicita da rota.
- A ordem de `allowedDelegateModels` nao deve decidir empate semantico entre modelos; o orquestrador deve escolher o alvo.
- A decisao de roteamento deve ser recebida como objeto estruturado ou tool arguments validados, nunca como texto a ser interpretado como JSON.
- O backend deve rejeitar ou pedir reparo quando o orquestrador escolher modelo nao permitido, capability nao declarada, grafo invalido ou fallback nao permitido.
- Falhas de roteamento antes do primeiro chunk devem retornar erro OpenAI-compatible.
- Falhas apos inicio do stream devem fechar SSE de forma controlada e sem vazar detalhes internos.

## Fora de escopo

- Expor decisoes de roteamento ao cliente.
- Streaming publico de multiplos agentes internos.
- Recursive orchestration ou `maxDepth` maior que `1`.
- Trocar o contrato publico de `/v1/chat/completions`.
- Criar provider novo ou depender de comportamento especifico do OpenRouter.
- Implementar observabilidade completa; a [Spec 008](./008-observability-resilience-security.md) continua governando logs, request id, resiliencia e seguranca operacional.

## Comportamento de falha

- Decisao ausente, malformada ou nao parseavel: solicitar reparo uma vez quando houver budget; se persistir, retornar erro antes de SSE.
- Decisao retornada como texto, mesmo contendo JSON valido: tratar como malformada, solicitar reparo estruturado quando houver budget e falhar antes de SSE se persistir.
- Modelo/provider sem suporte a objeto estruturado ou tool call obrigatoria: considerar a rota incapaz de executar match por orquestrador e retornar erro de configuracao/roteamento antes de SSE.
- `target_model` fora de `allowedDelegateModels`: bloquear antes de provider call.
- `matched_capability` nao declarada pelo modelo escolhido: bloquear ou pedir reparo ao orquestrador; nao escolher outro modelo por codigo.
- `orchestrator_fallback` nao permitido por `allowOrchestratorFallback: false`: bloquear antes de provider call.
- Grafo com ciclos, dependencies ausentes, mais de um alvo final, recursao ou excesso de limites: rejeitar antes de SSE.
- Timeout durante roteamento ou reparo: retornar erro normalizado antes de SSE.
- Provider failure no stream final: fechar SSE de forma controlada e registrar falha sem prompts, respostas completas ou segredos.

## Criterios de aceite

- Requisicoes com `stream: true` usam uma decisao estruturada do orquestrador para escolher capability e alvo final.
- A decisao estruturada chega ao servico de orquestracao como objeto validado ou tool arguments validados; texto com JSON, markdown ou code fence e rejeitado.
- O backend nao usa heuristicas locais de texto, prioridade fixa de capabilities ou ordem de `allowedDelegateModels` para escolher o match semantico.
- Um delegado com capability nao canonica, por exemplo `math`, pode ser escolhido pelo orquestrador e aceito pelo backend quando estiver permitido na rota e declarar essa capability.
- Quando dois delegados declaram a mesma capability, a escolha do orquestrador e respeitada se passar na validacao mecanica.
- Quando o orquestrador escolhe modelo permitido mas capability nao declarada por esse modelo, o backend bloqueia ou pede reparo, sem autocorrecao local para outro delegado.
- Rotas de routed streaming nao falham no boot apenas por nao terem delegado `general`, salvo politica explicita que exija isso.
- `orchestrator_fallback` so e usado quando escolhido explicitamente pelo orquestrador e permitido por `allowOrchestratorFallback` habilitado ou ausente.
- Nenhum chunk SSE contem decisao de roteamento, capabilities internas, tool calls, grafo, prompts operacionais ou resultados delegados brutos.
- Guardrails existentes de `allowedDelegateModels`, `maxDelegations`, `maxDepth`, timeouts, provider errors e normalizacao OpenAI-compatible continuam aplicados.

## Testes esperados

- Unit test garantindo que um prompt de codigo pode ser roteado para o delegado escolhido pelo orquestrador, sem classificacao local obrigatoria como `code`.
- Unit test garantindo que capability nao canonica declarada, como `math`, e aceita quando o orquestrador escolhe um delegado permitido com essa capability.
- Unit test garantindo que empate entre dois delegados com a mesma capability e resolvido pela decisao do orquestrador, nao pela ordem da configuracao.
- Unit test garantindo que falta de delegado `general` nao invalida routed streaming por si so.
- Unit test garantindo bloqueio ou reparo quando `matched_capability` nao existe no modelo escolhido.
- Unit test garantindo bloqueio quando `target_model` nao esta em `allowedDelegateModels`.
- Unit test garantindo que o backend nao corrige `target_model` para outro delegado com base em heuristica local.
- Unit test para decisao malformada antes de SSE retornando erro OpenAI-compatible.
- Unit test garantindo que texto contendo JSON e rejeitado como decisao de roteamento, mesmo quando o JSON seria parseavel.
- Unit test garantindo que a chamada de roteamento usa objeto estruturado ou tool call obrigatoria, nao `message.content`.
- Unit test garantindo erro antes de SSE quando o provider/modelo nao consegue cumprir o contrato estruturado.
- Unit ou integration test garantindo que SSE final nao contem metadados internos de roteamento.

## Ordem de implementacao

1. Definir o schema interno da decisao estruturada do orquestrador.
2. Criar a operacao interna de geracao estruturada ou tool call obrigatoria na porta de provider/orquestracao.
3. Escrever testes que rejeitam texto contendo JSON e provam que o backend nao faz match semantico por codigo.
4. Adaptar o prompt/tool contract do orquestrador para retornar `matched_capability`, alvo final e tasks internas somente pelo canal estruturado.
5. Remover classificacao local por keywords, prioridade fixa e selecao automatica por primeiro delegado.
6. Manter validacao mecanica de modelo permitido, capability declarada, grafo, limites e fallback.
7. Ajustar validacao de configuracao para aceitar capabilities nao canonicas em routed streaming.
8. Atualizar testes de routed streaming, fallback e graph validation.
9. Rodar testes alvo, suite relevante, typecheck, lint e formatacao.

## Specs relacionadas

- [Spec 002](./002-llm-orchestration-routing.md)
- [Spec 006](./006-streaming-final-with-internal-delegations.md)
- [Spec 008](./008-observability-resilience-security.md)

## ADRs relacionados

- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)
