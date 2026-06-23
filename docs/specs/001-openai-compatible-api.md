# Spec 001: API compativel com OpenAI

## Status

Draft

## Objetivo

Definir a superficie HTTP inicial do gateway para que clientes e SDKs compativeis com OpenAI consigam consumir o Open Fusion trocando apenas `baseURL` e credencial.

## Endpoints MVP

### `POST /v1/chat/completions`

Endpoint principal para completions conversacionais.

Campos de entrada suportados inicialmente:

- `model`: string obrigatoria. Identifica um modelo publico ou uma rota logica do gateway.
- `messages`: array obrigatorio de mensagens no formato Chat Completions.
- `stream`: boolean opcional.
- `temperature`: number opcional.
- `top_p`: number opcional.
- `max_tokens`: number opcional.
- `stop`: string ou array opcional.
- `tools`: array opcional, aceito para compatibilidade. O MVP deve repassar apenas quando a rota permitir.
- `tool_choice`: string ou objeto opcional.
- `metadata`: objeto opcional, usado apenas internamente quando permitido.

Campos desconhecidos devem ser preservados em `providerOptions` quando houver mapeamento seguro. Caso contrario, devem ser ignorados ou rejeitados conforme politica de compatibilidade configurada.

### `GET /v1/models`

Retorna modelos e rotas expostos ao cliente.

Cada item deve conter:

- `id`: identificador publico usado no campo `model`.
- `object`: `model`.
- `created`: timestamp Unix, quando conhecido.
- `owned_by`: `open-fusion` ou valor configurado.

## Autenticacao

Clientes chamam o gateway com:

```http
Authorization: Bearer <gateway-api-key>
```

O token recebido autentica o cliente do gateway. Ele nao deve ser repassado ao provider. Credenciais de providers sao resolvidas apenas pela configuracao do servidor.

## Resposta sem streaming

A resposta deve seguir o envelope Chat Completions sempre que possivel:

```json
{
  "id": "chatcmpl_<id>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "route/default",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

Quando o uso de tokens nao estiver disponivel, o campo `usage` pode ser omitido ou preenchido conforme politica configurada.

## Resposta com streaming

Quando `stream: true`, o gateway deve responder com `text/event-stream` e eventos `data:` compativeis com Chat Completions streaming. O stream termina com:

```text
data: [DONE]
```

## Erros

Erros devem seguir envelope compativel com OpenAI:

```json
{
  "error": {
    "message": "Mensagem legivel",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

Mapeamento minimo:

- 400: requisicao invalida.
- 401: token ausente ou invalido.
- 403: cliente sem permissao para modelo ou rota.
- 404: modelo publico inexistente.
- 408: timeout.
- 429: limite excedido.
- 500: erro interno.
- 502: erro de provider.
- 503: provider indisponivel.

## Compatibilidade planejada

O primeiro contrato sera Chat Completions por aderencia a clientes existentes e ao OpenRouter. A API Responses pode ser adicionada depois como nova spec, mantendo `/v1/chat/completions` estavel.

## Criterios de aceite

- Um cliente OpenAI SDK consegue chamar o gateway configurando `baseURL`.
- `POST /v1/chat/completions` funciona com e sem streaming.
- `GET /v1/models` lista apenas modelos publicos.
- Credenciais de provider nunca aparecem na resposta.

## ADRs relacionados

- [ADR 0002](../adrs/0002-openai-compatible-public-api.md)
- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)

