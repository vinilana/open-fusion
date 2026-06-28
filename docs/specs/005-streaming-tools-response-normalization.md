# Spec 005: Streaming, tools e normalizacao de respostas

## Status

Draft

## Objetivo

Definir como o gateway lida com streaming, tool calling e conversao entre formatos internos do Vercel AI SDK e o contrato OpenAI-compatible.

## Politica geral de execucao

O fluxo de resposta deve ser executado em fases explicitas. Cada fase tem entrada, saida e responsabilidades proprias para evitar vazamento de detalhes internos, facilitar testes e manter separacao entre HTTP, orquestracao, provider adapters e normalizacao.

No MVP, a politica recomendada e `streamFinalOnly: true`:

- chamadas internas do orquestrador e delegados podem ser streaming ou nao;
- somente tokens da resposta final sao enviados ao cliente;
- eventos intermediarios de delegacao nao sao expostos no stream OpenAI-compatible;
- falhas antes da emissao de qualquer chunk devem retornar erro HTTP OpenAI-compatible;
- falhas depois do inicio do stream devem ser normalizadas como encerramento controlado do stream, sem expor stack trace, segredos ou traces de orquestracao.

Essa abordagem reduz acoplamento com detalhes da orquestracao e evita vazar raciocinio operacional.

## Fases de execucao

### Fase 1: Recepcao e validacao da requisicao

Subtarefas:

1. Validar que a chamada chegou em `/v1/chat/completions` com autenticacao ja aprovada pelas camadas de seguranca.
2. Validar o envelope OpenAI-compatible da requisicao, incluindo `model`, `messages`, `stream`, `tools`, `tool_choice` e parametros suportados.
3. Rejeitar campos, combinacoes ou tamanhos que excedam limites configurados pela rota.
4. Identificar se a resposta sera normal ou SSE com base em `stream: true`.
5. Criar o contexto interno da requisicao com `requestId`, rota selecionada, modelo publico solicitado e flags de resposta.

Saida esperada:

- requisicao validada e normalizada para processamento interno;
- erro OpenAI-compatible quando a validacao falhar.

### Fase 2: Preparacao do contexto de orquestracao

Subtarefas:

1. Resolver a rota ativa e o orquestrador aplicavel.
2. Converter mensagens OpenAI para o formato aceito pelo Vercel AI SDK.
3. Separar tools externas enviadas pelo cliente das tools internas do gateway.
4. Permitir tools externas apenas quando a rota declarar suporte explicito.
5. Injetar a tool interna `delegate_llm` apenas no contexto do orquestrador, nunca no contrato visivel ao cliente.
6. Montar instrucoes internas sobre modelos delegaveis, limites de delegacao, timeouts e politica `streamFinalOnly`.

Saida esperada:

- payload interno pronto para chamar o orquestrador;
- lista controlada de tools disponiveis ao orquestrador;
- nenhuma tool interna exposta como escolha direta do cliente.

### Fase 3: Execucao do orquestrador

Subtarefas:

1. Chamar o modelo orquestrador por meio do servico interno que usa provider adapters e Vercel AI SDK.
2. Capturar eventos de geracao, tool calls, uso de tokens, finish reason e metadados disponiveis.
3. Tratar tool calls do orquestrador como pedidos internos, nao como resposta publica imediata.
4. Aplicar limites de profundidade, quantidade de delegacoes, timeout total e timeout por chamada.
5. Interromper a execucao com erro normalizado quando limites forem violados ou provider falhar de forma irrecuperavel.

Saida esperada:

- resposta direta do orquestrador; ou
- uma ou mais chamadas internas de `delegate_llm`; ou
- erro normalizado quando a execucao nao puder continuar.

### Fase 4: Execucao de delegacoes internas

Subtarefas:

1. Validar que cada chamada `delegate_llm` referencia apenas modelos permitidos pela rota ativa.
2. Rejeitar tentativas de delegacao para modelos nao autorizados, inexistentes ou incompativeis com a tarefa.
3. Construir o prompt da chamada delegada com a tarefa solicitada e o menor contexto necessario.
4. Executar a chamada delegada pelo provider adapter correspondente.
5. Capturar status, conteudo, uso de tokens, latencia, finish reason e erro normalizado quando houver.
6. Mascarar segredos e metadados sensiveis antes de inserir qualquer resultado no contexto do orquestrador.
7. Tratar todo conteudo retornado por modelos delegados como nao confiavel.

Saida esperada:

- resultado delimitado da delegacao para reinsercao no contexto do orquestrador;
- erro controlado quando a delegacao for bloqueada, expirar ou falhar.

### Fase 5: Reinsercao dos resultados e sintese final

Subtarefas:

1. Inserir resultados de modelos delegados no contexto do orquestrador com delimitacao clara.
2. Preservar metadados uteis, como modelo chamado, tarefa solicitada, status, latencia e uso quando disponivel.
3. Impedir que conteudo delegado altere instrucoes de sistema, politicas da rota ou limites de execucao.
4. Solicitar ao orquestrador a resposta final para o cliente.
5. Encerrar novas delegacoes quando limites forem atingidos ou quando a rota exigir resposta final.

Saida esperada:

- texto final, tool calls finais permitidas ou erro normalizado;
- nenhum trace operacional exposto por default ao cliente.

### Fase 6: Normalizacao da resposta final

Subtarefas:

1. Converter o resultado final do SDK para envelope Chat Completions.
2. Mapear `finish_reason` para os valores publicos suportados.
3. Agregar uso de tokens do orquestrador, delegacoes e sintese final quando providers retornarem essa informacao.
4. Preservar uso por etapa apenas em logs estruturados e telemetria interna.
5. Remover mensagens internas, prompts de orquestracao, resultados brutos de delegacao e metadados sensiveis da resposta publica.
6. Normalizar erros para o envelope OpenAI-compatible quando a resposta final nao puder ser produzida.

Saida esperada:

- resposta nao-streaming OpenAI-compatible; ou
- plano de emissao SSE quando `stream: true`.

### Fase 7: Emissao de streaming SSE

Subtarefas:

1. Abrir resposta `text/event-stream` apenas depois que a requisicao e a rota estiverem validadas.
2. Emitir chunks OpenAI-compatible somente para a resposta final.
3. Nao emitir eventos intermediarios de delegacao, traces internos, prompts, tool results brutos ou metadados sensiveis.
4. Manter `id`, `object`, `created`, `model`, `choices`, `delta` e `finish_reason` coerentes entre chunks.
5. Encerrar sempre com `data: [DONE]` quando o stream for iniciado com sucesso.
6. Registrar erro interno e encerrar de forma controlada se uma falha acontecer durante o stream.

Saida esperada:

- stream SSE compativel com clientes OpenAI;
- terminacao com `[DONE]` apos sucesso ou encerramento controlado.

### Fase 8: Registro operacional e encerramento

Subtarefas:

1. Registrar logs estruturados com `requestId`, rota, modelo publico, provider, modelo interno, latencia, status e uso quando disponivel.
2. Registrar uso por etapa sem incluir prompts completos, respostas completas, bearer tokens, API keys ou authorization headers.
3. Normalizar erros de provider sem vazar credenciais, stack traces ou detalhes sensiveis.
4. Atualizar metricas de sucesso, falha, timeout, delegacoes bloqueadas e tokens agregados.
5. Garantir que recursos de stream, timers e chamadas pendentes sejam encerrados.

Saida esperada:

- observabilidade minima completa para auditoria e depuracao;
- nenhum segredo em logs, erros ou respostas.

## Streaming

O gateway deve suportar `stream: true` em `/v1/chat/completions`.

## Tool calling

Existem dois tipos de tools:

- tools externas enviadas pelo cliente;
- tools internas do gateway, como `delegate_llm`.

No MVP, a tool interna tem prioridade operacional e nao deve ser visivel como tool escolhivel pelo cliente. Tools externas do cliente so devem ser repassadas quando a rota permitir explicitamente.

## Normalizacao de mensagens

O gateway deve converter:

- mensagens OpenAI para formato aceito pelo Vercel AI SDK;
- tool calls internas para execucoes controladas pelo backend;
- resultado final do SDK para envelope Chat Completions;
- eventos de stream do SDK para chunks OpenAI-compatible.

## Conteudo intermediario

Resultados de modelos delegados devem ser inseridos no contexto do orquestrador com delimitacao clara, incluindo:

- modelo chamado;
- tarefa solicitada;
- status;
- conteudo retornado;
- metadados disponiveis.

O conteudo deve ser tratado como nao confiavel e nao deve ganhar autoridade sobre instrucoes de sistema.

## Uso de tokens

O gateway deve tentar coletar uso por:

- chamada do orquestrador;
- chamadas delegadas;
- resposta final.

Quando possivel, a resposta ao cliente deve conter uso agregado. Logs estruturados devem preservar uso por etapa.

## Finish reasons

Mapeamento minimo:

- `stop` quando a resposta termina naturalmente;
- `length` quando limite de tokens e atingido;
- `tool_calls` quando o modelo solicita tools em resposta final;
- `content_filter` quando provider sinaliza bloqueio;
- `error` em logs internos, mas convertido para erro HTTP quando impedir resposta.

## Regras de falha por fase

- Falhas na Fase 1 ou Fase 2 devem retornar erro HTTP OpenAI-compatible e nao devem iniciar stream.
- Falhas na Fase 3, Fase 4 ou Fase 5 devem ser convertidas em erro HTTP quando nenhum chunk tiver sido emitido.
- Falhas durante a Fase 7 devem encerrar o stream de forma controlada e registrar o erro internamente.
- Bloqueios de `delegate_llm` por politica devem ser visiveis ao orquestrador como resultado controlado, nao como excecao bruta de provider.
- Timeouts devem preservar `requestId` e categoria de falha nos logs, sem expor prompts ou respostas completas.

## Criterios de aceite

- Cada fase possui teste unitario ou de integracao cobrindo entrada valida, falha esperada e saida normalizada quando aplicavel.
- Streaming retorna chunks validos e termina com `[DONE]`.
- Resposta final nao vaza mensagens internas de delegacao.
- Tool interna `delegate_llm` nao pode ser chamada diretamente pelo cliente.
- Tools externas do cliente so sao repassadas quando a rota permitir explicitamente.
- Delegacoes para modelos fora da rota ativa sao bloqueadas antes de chamar providers.
- Uso de tokens e agregado quando providers retornam essa informacao.
- Logs preservam uso por etapa e mascaram segredos, prompts completos e respostas completas.
- Erros antes do inicio do stream retornam envelope OpenAI-compatible; erros durante stream nao vazam detalhes sensiveis.

## ADRs relacionados

- [ADR 0002](../adrs/0002-openai-compatible-public-api.md)
- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
