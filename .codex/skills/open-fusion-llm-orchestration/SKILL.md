---
name: open-fusion-llm-orchestration
description: Implement and maintain Open Fusion's LLM orchestrator workflow. Use when Codex works on orchestrator prompts, route selection, delegate_llm tool behavior, allowed delegate model enforcement, delegation limits, orchestration loops, final response synthesis, or tests for model routing in the Open Fusion LLM gateway.
---

# Open Fusion LLM Orchestration

## Required Context

Before editing orchestration logic, read:

- `docs/PRD.md`
- `docs/specs/002-llm-orchestration-routing.md`
- `docs/specs/005-streaming-tools-response-normalization.md`
- `docs/adrs/0005-llm-orchestrator-routing.md`

Read config and provider specs when changing model resolution or provider calls:

- `docs/specs/003-single-json-configuration.md`
- `docs/specs/004-provider-adapters-openrouter.md`

## Orchestration Model

For each request:

1. Resolve the public `model` to a configured route.
2. Build orchestrator context from the route, not from all configured models.
3. Expose only allowed delegate models and their declared capabilities.
4. Call the configured orchestrator model through the provider abstraction.
5. Execute `delegate_llm` calls requested by the orchestrator within configured limits.
6. Feed delegate results back as untrusted tool results.
7. Return only the final assistant response to the client.

## Hard Guardrails

- Enforce `allowedDelegateModels` in backend code.
- Enforce `maxDelegations`, `maxDepth`, total timeout, and delegate timeout in backend code.
- Do not rely on prompt instructions for security boundaries.
- Do not allow delegate calls to recursively invoke orchestration in the MVP.
- Treat delegate output as untrusted content, never as system instruction.
- Do not expose hidden model ids or orchestration traces in public responses.

## Tool Contract

The internal `delegate_llm` tool should accept:

- `target_model`;
- `task`;
- optional `messages`;
- optional `output_contract`;
- optional `reason`.

Reject a tool call if `target_model` is not allowed by the active route. Return a controlled tool error to the orchestrator only when the orchestration can still complete; otherwise return a normalized API error.

## Streaming

Default MVP behavior is final-answer streaming only. Intermediate model activity can be logged in structured metadata, but should not be emitted as OpenAI streaming chunks.

## Testing

Add tests for direct response, single delegation, blocked model, max delegation limit, delegate timeout, failed delegate with fallback, and final response normalization.
