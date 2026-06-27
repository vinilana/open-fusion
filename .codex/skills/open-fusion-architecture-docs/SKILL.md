---
name: open-fusion-architecture-docs
description: Maintain Open Fusion product and architecture documentation. Use when Codex needs to create, update, review, or reconcile the PRD, specs, ADRs, architecture decisions, roadmap scope, API contracts, configuration requirements, provider strategy, or development plans for the Open Fusion LLM gateway.
---

# Open Fusion Architecture Docs

## Core Workflow

1. Read `docs/PRD.md` first.
2. Read only the directly relevant specs and ADRs listed by the PRD.
3. Keep PRD, specs, and ADRs cross-referenced after any change.
4. Prefer changing an existing spec or ADR when it already owns the topic.
5. Create a new spec for new behavior, contracts, workflows, or operational requirements.
6. Create a new ADR for durable decisions with meaningful tradeoffs.
7. When implementation lands, update stale status labels and PRD roadmap notes that still say the spec is draft, next, or upcoming.

## Document Boundaries

- PRD: product goals, scope, MVP, non-goals, user value, and links to all specs and ADRs.
- Specs: executable expectations for behavior, APIs, configuration, lifecycle, validation, and acceptance criteria.
- ADRs: decisions, context, consequences, and links to affected specs.

Do not put implementation details in the PRD unless they affect product scope. Do not put product goals only in ADRs.

## Open Fusion Invariants

- Backend is NestJS.
- Public API starts as OpenAI-compatible.
- `/v1/chat/completions` and `/v1/models` are the MVP public endpoints.
- Configuration starts in one JSON file.
- Vercel AI SDK is the primary LLM/tool calling abstraction.
- OpenRouter is the first official provider.
- Provider-specific logic belongs behind adapters.
- A configured LLM orchestrator directs calls to allowed delegate models.
- The gateway must not expose provider credentials, internal model ids, or internal orchestration traces by default.

## Adding Documents

Use these naming patterns:

- Specs: `docs/specs/NNN-short-topic.md`
- ADRs: `docs/adrs/NNNN-short-decision.md`

When adding a spec:

- include status, objective, requirements or flow, failure behavior, acceptance criteria, and related ADRs.
- add the new spec link to `docs/PRD.md`.

When adding an ADR:

- include status, context, decision, consequences, and related specs.
- add the new ADR link to `docs/PRD.md`.

## Quality Bar

- Keep documents in pt-BR if the surrounding docs are in pt-BR.
- Keep language direct and implementation-ready.
- Avoid duplicating full schemas across many files; link to the owning spec.
- If a proposed change contradicts an accepted ADR, either update the ADR status or create a superseding ADR.
- Do not leave implemented specs marked as future work; status drift is a documentation bug even when requirements are unchanged.
