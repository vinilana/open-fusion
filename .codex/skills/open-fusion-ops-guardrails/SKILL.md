---
name: open-fusion-ops-guardrails
description: Add and enforce Open Fusion operational guardrails. Use when Codex works on request ids, structured logging, metrics, health checks, authentication, authorization, payload limits, timeout/retry policy, redaction, provider failure handling, rate limiting, or security/resilience tests for the Open Fusion LLM gateway.
---

# Open Fusion Ops Guardrails

## Required Context

Before editing operational, security, or resilience code, read:

- `docs/PRD.md`
- `docs/specs/007-observability-resilience-security.md`
- `docs/specs/001-openai-compatible-api.md`
- `docs/adrs/0002-openai-compatible-public-api.md`

Read config and orchestration specs when changing limits:

- `docs/specs/003-single-json-configuration.md`
- `docs/specs/002-llm-orchestration-routing.md`

## Request Lifecycle Guardrails

Every `/v1/*` request should have:

- authentication, except explicitly public health endpoints;
- request id generation or propagation;
- payload validation and size limits;
- route/model authorization;
- timeout enforcement;
- structured completion log;
- normalized OpenAI-style error response on failure.

Log failures consistently even when validation, model access, route resolution, or tools policy fails before a full route context exists.

## Logging

Log structured fields:

- `requestId`;
- authenticated client id;
- public route/model;
- orchestrator model key;
- delegate model keys;
- provider;
- status;
- latency;
- token usage when available;
- normalized error code/type.

Do not log provider API keys, bearer tokens, authorization headers, raw full prompts, or raw full responses by default.

Internal configuration identifiers, such as internal model ids, provider model ids, provider config keys, and secret env var names, belong in structured diagnostic logs only when useful for operators and must still follow redaction rules. They must not be copied into public error messages.

## Error Handling

Normalize failures into OpenAI-compatible error envelopes where possible. Preserve enough internal detail in logs to debug provider failures, but keep public messages stable and non-sensitive.

For `internal_error`/500 responses, use generic public messages. Do not include unresolved internal model ids, provider model ids, provider config keys, env var names, stack traces, or registry details in the `OpenAiHttpError` message that reaches `error.toBody()`.

Use appropriate status codes:

- 400 invalid request;
- 401 missing or invalid token;
- 403 unauthorized model/route;
- 404 unknown public model;
- 408 timeout;
- 429 limit exceeded;
- 502 provider failure;
- 503 provider unavailable;
- 500 internal error.

Do not classify gateway configuration or wiring defects as provider failures. Use `internal_error`/500 when the gateway cannot resolve an internal model or provider before making an upstream call.

## Runtime And Cost Guardrails

- Declare the supported Node.js engine range when dependencies require a specific runtime.
- Enforce payload, message count, message content, timeout, and delegation limits in backend code, not only in prompts.
- Prefer real cancellation for in-flight parallel provider/delegate work after terminal failure; if cancellation is not implemented, make the residual cost behavior explicit and covered by tests.

## Health Checks

Provide:

- `GET /health/live` for process liveness;
- `GET /health/ready` for boot readiness and config validity.

Do not perform paid provider calls from health checks by default.

## Testing

Add tests for redaction, request id propagation, auth rejection, payload limits, failed-request logging before route resolution, timeout mapping, provider error mapping, internal configuration error mapping, cancellation or ignored-late-result behavior, and health endpoint behavior.

When an internal configuration error needs diagnostic context, test both sides of the boundary: structured logs may contain the useful internal identifier after redaction policy, while the public OpenAI-compatible error body must remain generic and must not expose the internal identifier.
