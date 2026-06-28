---
name: open-fusion-nestjs-api
description: Build and maintain the Open Fusion NestJS backend API. Use when Codex implements or changes OpenAI-compatible HTTP endpoints, NestJS modules/controllers/services, request validation, streaming SSE responses, OpenAI-style error envelopes, model listing, authentication guards, or API tests for the Open Fusion LLM gateway.
---

# Open Fusion NestJS API

## Required Context

Before editing API code, read:

- `docs/PRD.md`
- `docs/specs/001-openai-compatible-api.md`
- `docs/specs/005-streaming-tools-response-normalization.md`
- `docs/adrs/0001-use-nestjs-backend.md`
- `docs/adrs/0002-openai-compatible-public-api.md`

Also read `docs/specs/007-observability-resilience-security.md` when touching auth, errors, logs, limits, health checks, or request ids.

## API Contract

Preserve these MVP endpoints:

- `POST /v1/chat/completions`
- `GET /v1/models`

Treat OpenAI compatibility as the public contract. A client should be able to change `baseURL` and token without learning Open Fusion internals.

## NestJS Structure

Prefer modules with clear ownership:

- API/controller layer: HTTP shape, status codes, headers, SSE response framing.
- Application services: route resolution, orchestration request lifecycle, response normalization.
- Config services: validated configuration access only.
- Provider services: call adapters, never import provider SDKs in controllers.
- Guards/interceptors/filters: auth, request id, logging, error normalization.

Do not let controllers import OpenRouter, Vercel provider packages, or raw configuration files directly.

## Chat Completions Rules

- Validate `model` and `messages` before orchestration.
- Reject non-finite numeric request fields (`NaN`, `Infinity`, `-Infinity`) with an OpenAI-style validation error.
- Enforce configured payload, message-count, and message-content limits before orchestration.
- Preserve compatible request fields when supported.
- Reject or ignore unsupported fields consistently with the configured compatibility policy.
- Return OpenAI-style error envelopes.
- For `stream: true`, use `text/event-stream` and terminate with `data: [DONE]`.
- Do not stream internal delegation traces unless a future spec explicitly allows it.

## Controller Logging Rules

- Put context creation, validation, route lookup, model access checks, and tools policy checks inside the failure logging path.
- If a request fails before route/orchestrator resolution, log a minimal `chat_completion.failed` event with `requestId`, client id when known, stream flag when known, latency, and normalized error.
- Never open SSE before all pre-stream validation and routing failures that should return JSON have been handled.

## Testing

Add focused tests for:

- request validation;
- `NaN`/`Infinity` numeric rejection;
- message count, message content, and payload limits;
- auth failures;
- unknown public model;
- failure logs for validation/model/tool-policy errors before SSE starts;
- non-streaming response envelope;
- streaming chunk shape and `[DONE]`;
- provider/orchestration errors mapped to OpenAI-style errors.

When API behavior changes, update the owning spec before or with the implementation.
