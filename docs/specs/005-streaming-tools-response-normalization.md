# Spec 005: Streaming, tools e normalizacao de respostas

## Status

Draft

## Objetivo

Definir como o gateway lida com streaming, tool calling e conversao entre formatos internos do Vercel AI SDK e o contrato OpenAI-compatible.

## Streaming

O gateway deve suportar `stream: true` em `/v1/chat/completions`.

No MVP, a politica recomendada e `streamFinalOnly: true`:

- chamadas internas do orquestrador e delegados podem ser streaming ou nao;
- somente tokens da resposta final sao enviados ao cliente;
- eventos intermediarios de delegacao nao sao expostos no stream OpenAI-compatible.

Essa abordagem reduz acoplamento com detalhes da orquestracao e evita vazar raciocinio operacional.

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

## Criterios de aceite

- Streaming retorna chunks validos e termina com `[DONE]`.
- Resposta final nao vaza mensagens internas de delegacao.
- Tool interna `delegate_llm` nao pode ser chamada diretamente pelo cliente.
- Uso de tokens e agregado quando providers retornam essa informacao.

## ADRs relacionados

- [ADR 0002](../adrs/0002-openai-compatible-public-api.md)
- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)

