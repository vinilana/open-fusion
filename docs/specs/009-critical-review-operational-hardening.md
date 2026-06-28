# Spec 009: Hardening operacional apos revisao critica

## Status

Implemented

## Objetivo

Aplicar os hardenings operacionais identificados na revisao critica da implementacao da Spec 007, sem alterar o contrato publico OpenAI-compatible de `/v1/chat/completions` e `/v1/models`.

Esta spec governa ajustes transversais de saude operacional, logs HTTP genericos, redaction configuravel, limite global de parsing de payload e quality gate local agregado.

## Contexto

A Spec 007 moveu o match semantico de capabilities para a LLM orquestradora e manteve o backend como guardrail deterministico. A revisao critica dessa implementacao encontrou lacunas fora do caminho principal de roteamento:

- health checks publicos ainda nao existiam;
- falhas de autenticacao antes dos controllers nao eram auditadas por log estruturado;
- `/v1/models` nao emitia log operacional de sucesso;
- `observability.redact` existia na configuracao bruta, mas nao era aplicado pelo runtime;
- o parser HTTP usava limite derivado das rotas em vez de um limite global explicito;
- nao havia script unico para executar os gates locais relevantes.

## Requisitos

### Health checks

- `GET /health/live` deve responder sem autenticacao.
- `GET /health/ready` deve responder sem autenticacao quando a configuracao ja foi carregada e validada no boot.
- Health checks nao devem fazer chamadas pagas a providers por default.

### Logs HTTP genericos

- Falhas em rotas `/v1/*` que acontecem antes do controller devem gerar log estruturado generico.
- `GET /v1/models` deve gerar log estruturado generico em sucesso.
- Logs HTTP genericos devem conter `requestId`, metodo, path, status, statusCode, latencia e `clientId` quando autenticado.
- Logs HTTP genericos nao devem conter bearer tokens, authorization headers, prompts completos, respostas completas ou chaves de provider.
- O log especifico de chat completions continua sendo o dono de eventos `chat_completion.*`.

### Redaction configuravel

- `observability.redact` deve ser carregado no runtime.
- Chaves padrao de redaction (`authorization`, `apiKey`, `api_key`, `token`) continuam ativas mesmo quando a configuracao declara chaves extras.
- Chaves configuradas tambem devem cobrir a variante terminada em `Env`, por exemplo `token` cobre `tokenEnv`.
- O redactor central deve ser reutilizavel em erros e conteudo interno reinserido no fluxo de orquestracao.

### Limite global de payload HTTP

- `server.maxPayloadBytes`, quando configurado, define o limite global do parser HTTP antes de resolucao de rota.
- `server.maxPayloadBytes` deve ser inteiro positivo.
- Na ausencia de `server.maxPayloadBytes`, o limite global do parser pode ser derivado do maior `routes.*.maxPayloadBytes` validado para preservar compatibilidade operacional.
- Limites por rota continuam sendo aplicados depois que o payload e parseado e a rota e resolvida.

### Quality gate local

- O projeto deve expor um script local agregado para rodar testes unitarios, e2e, typecheck, lint e formatacao.

## Fora de escopo

- Persistir logs em banco ou sistema externo.
- Criar dashboard de health ou metricas.
- Implementar rate limiting distribuido.
- Criar workflow remoto obrigatorio de GitHub Actions.

## Criterios de aceite

- Health checks retornam 200 sem autenticacao e sem chamar providers.
- Falha de autenticacao em `/v1/*` gera log estruturado sem token.
- Sucesso em `/v1/models` gera log estruturado sem listar modelos ou tokens.
- Redaction mascara campos configurados e variantes `*Env`.
- `server.maxPayloadBytes` e validado e usado pelo parser HTTP quando presente.
- `npm run ci` executa os gates locais relevantes.

## Specs relacionadas

- [Spec 001](./001-openai-compatible-api.md)
- [Spec 003](./003-single-json-configuration.md)
- [Spec 007](./007-orchestrator-capability-matching.md)
- [Spec 008](./008-observability-resilience-security.md)

## ADRs relacionados

- [ADR 0001](../adrs/0001-use-nestjs-backend.md)
- [ADR 0004](../adrs/0004-single-json-configuration.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)

