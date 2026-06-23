# Spec 004: Providers e OpenRouter

## Status

Draft

## Objetivo

Definir a camada de providers e o suporte oficial inicial ao OpenRouter.

## Interface conceitual de provider

Todo provider adapter deve oferecer:

- criacao de modelo de texto a partir de uma entrada da configuracao;
- suporte a chamada sem streaming;
- suporte a chamada com streaming quando o provider permitir;
- suporte a tool calling quando o provider/modelo permitir;
- normalizacao de erros;
- normalizacao de metadados de uso quando disponiveis.

## OpenRouter

OpenRouter sera o primeiro provider oficial. A implementacao deve usar Vercel AI SDK e o provider OpenRouter quando disponivel.

Configuracoes esperadas:

- `apiKeyEnv`: variavel que contem a API key do OpenRouter.
- `baseUrl`: URL base opcional, com default `https://openrouter.ai/api/v1`.
- `headers`: headers opcionais recomendados pelo provider, como referer e titulo da aplicacao.
- `providerOptions`: opcoes especificas repassadas de forma controlada.

## Modelo interno

O gateway diferencia:

- id publico: nome exposto ao cliente, por exemplo `open-fusion/default`;
- id interno: chave de configuracao, por exemplo `worker.fast`;
- model id do provider: id real usado no provider, por exemplo `openai/gpt-4.1-mini`.

O cliente so deve depender do id publico.

## Normalizacao de capacidades

Cada modelo configurado pode declarar capacidades:

- `general`;
- `reasoning`;
- `coding`;
- `long_context`;
- `vision`;
- `tool_calling`;
- `json_mode`;
- `fast_draft`;
- `low_cost`.

Essas capacidades orientam o orquestrador, mas nao substituem validacao real do provider.

## Novos providers

Adicionar um provider futuro deve exigir:

1. implementar adapter;
2. registrar `type` no modulo de providers;
3. adicionar validacao de configuracao;
4. adicionar testes de contrato;
5. documentar providerOptions aceitas.

Nao deve exigir mudanca em controllers HTTP.

## Criterios de aceite

- OpenRouter funciona como provider oficial inicial.
- A troca de provider de um modelo ocorre por configuracao.
- Controllers nao importam diretamente SDKs de providers especificos.
- Erros de provider sao convertidos para erros normalizados do gateway.

## ADRs relacionados

- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0006](../adrs/0006-openrouter-first-provider.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)

