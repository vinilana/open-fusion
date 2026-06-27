---
name: open-fusion-code-quality
description: Keep Open Fusion code maintainable with SOLID, DRY, clean architecture, and pragmatic TypeScript/NestJS design. Use when Codex designs modules, writes production code, refactors, reviews code quality, extracts abstractions, names services/adapters, or reduces duplication in the Open Fusion LLM gateway.
---

# Open Fusion Code Quality

## Required Context

Before judging design, read the relevant spec and ADR. For core architecture, read:

- `docs/PRD.md`
- `docs/adrs/0001-use-nestjs-backend.md`
- `docs/adrs/0003-use-vercel-ai-sdk.md`
- `docs/adrs/0007-provider-adapter-layer.md`

Use this skill with `open-fusion-tdd-cycle` for implementation changes.

## Design Principles

Apply SOLID pragmatically:

- Single Responsibility: controllers handle HTTP, config services handle config, adapters handle provider details, orchestration services handle orchestration policy.
- Open/Closed: new providers should be added by registering adapters, not editing controllers.
- Liskov Substitution: adapters must satisfy the same contract for success, stream, timeout, and error behavior.
- Interface Segregation: keep small interfaces for generation, streaming, config access, and secret resolution.
- Dependency Inversion: depend on internal abstractions, not concrete provider SDKs outside adapter modules.

Apply DRY after intent is clear:

- remove duplicated policy logic immediately;
- tolerate small duplicated tests until patterns stabilize;
- extract helpers only when they improve names and diagnostics;
- avoid generic abstractions for one provider or one endpoint.

## Open Fusion Boundaries

Keep these boundaries explicit:

- HTTP API: request validation, headers, status codes, SSE framing.
- Application orchestration: route resolution, delegate limits, final response lifecycle.
- Configuration: schema validation, env secret resolution, immutable runtime config.
- Provider adapters: Vercel AI SDK/provider specifics and error mapping.
- Observability/security: request ids, logging, redaction, auth, timeouts.

Crossing these boundaries should happen through typed interfaces.

## TypeScript Standards

- Prefer explicit domain types over loose `any`.
- Do not leave untyped locals that widen to `any` for provider, orchestration, or config results.
- Model config and API DTOs separately.
- Validate external input at boundaries before using typed runtime objects.
- Treat provider outputs as external input even when they came through an SDK type.
- Use discriminated unions for provider result/error variants when useful.
- Keep async cancellation/timeout behavior visible in function signatures or options.
- Extract shared domain types when the same request/client/config shape appears across services and Express request augmentation.

## NestJS Standards

- Keep controllers thin.
- Put business rules in injectable services.
- Use guards for auth, filters for error envelopes, interceptors/middleware for request id/logging where appropriate.
- Do not read env vars from controllers or orchestration services.
- Do not import provider SDK packages outside provider adapter modules.

## Code Smells To Fix

- provider-specific conditionals in controllers;
- repeated OpenAI error envelope construction;
- repeated config reference validation;
- raw secrets in logs or thrown errors;
- orchestration loops without hard backend limits;
- tests that only verify mocks were called;
- duplicated `AuthenticatedClient`-style shapes across services and request typings;
- provider payload casts without runtime validation;
- public or operational errors with misleading status/code semantics;
- abstractions named `Manager`, `Helper`, or `Util` without a clear domain role.

## Refactoring Rule

Refactor behind passing tests. If tests are missing, first add characterization tests for the behavior being preserved.
