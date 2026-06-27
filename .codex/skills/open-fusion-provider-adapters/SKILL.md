---
name: open-fusion-provider-adapters
description: Build and maintain Open Fusion provider adapters around the Vercel AI SDK. Use when Codex adds or changes OpenRouter integration, provider adapter interfaces, provider-specific configuration, model capability mapping, Vercel AI SDK calls, provider error normalization, provider tests, or support for future LLM providers.
---

# Open Fusion Provider Adapters

## Required Context

Before editing provider code, read:

- `docs/PRD.md`
- `docs/specs/004-provider-adapters-openrouter.md`
- `docs/adrs/0003-use-vercel-ai-sdk.md`
- `docs/adrs/0006-openrouter-first-provider.md`
- `docs/adrs/0007-provider-adapter-layer.md`

Read config and streaming specs when provider changes affect configuration or response shape:

- `docs/specs/003-single-json-configuration.md`
- `docs/specs/005-streaming-tools-response-normalization.md`

## Current External APIs

Vercel AI SDK, OpenRouter, and OpenAI-compatible behavior can change. When implementing against their APIs, verify current official docs or installed package types before coding. Prefer official docs and local package typings over memory.

## Adapter Boundary

Controllers and orchestration services should call an internal provider abstraction, not provider SDKs directly.

Each adapter should own:

- translating validated config into SDK model instances;
- applying provider-specific headers/options;
- invoking non-streaming generation;
- invoking streaming generation;
- exposing supported capabilities when known;
- normalizing provider errors;
- returning usage metadata when available.

## Boundary Validation

Treat every provider result as untrusted until normalized:

- Validate tool call names, ids, arguments, and optional fields before constructing internal `DelegateLlmToolCall` values.
- Do not cast provider-supplied `messages` directly to `ChatCompletionMessage[]`; validate each entry's object shape, role, content, and tool fields.
- Normalize empty dependency arrays intentionally. Preserve `depends_on: []` only if orchestration semantics require it; otherwise omit it so an empty array cannot change task classification.
- Drop or reject malformed provider tool payloads deterministically; do not let malformed provider data crash orchestration.
- Keep provider-originated content untrusted even after validation.

## Error Semantics

- Use `provider_error`/502 for upstream provider failures.
- Use `internal_error`/500 for gateway configuration or wiring faults, such as an internal model id that cannot be resolved before calling a provider.
- Redact provider error details before public errors or logs can expose credentials.

## Cancellation And Timeouts

- Keep timeout behavior explicit in adapter requests.
- When orchestration requires aborting parallel work, thread `AbortSignal` or an equivalent cancellation contract through the internal port and adapter instead of only ignoring late results.

## OpenRouter Rules

- OpenRouter is the first official provider.
- Resolve API keys through config secret references.
- Keep OpenRouter model ids as provider model ids, not public API ids.
- Support provider headers from config, including referer/title when configured.
- Do not assume every OpenRouter model supports tools, JSON mode, vision, or streaming equally.

## Adding a Provider

When adding another provider:

1. Add or extend the provider config schema.
2. Implement a provider adapter.
3. Register the provider type in one composition point.
4. Add adapter contract tests.
5. Document provider-specific options in the provider spec or a new spec.

Do not change public API controllers just to add a provider.

## Testing

Use mocks or test doubles for provider calls by default. Add integration tests only when credentials and cost controls are explicit. Cover success, stream, tool-capable calls, malformed tool payloads, malformed delegate messages, unsupported capability, timeout, cancellation when supported, unknown internal model ids, and error normalization.
