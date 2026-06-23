---
name: open-fusion-tdd-cycle
description: Enforce test-driven development for Open Fusion. Use when Codex implements features, fixes bugs, changes behavior, refactors production code, or modifies API/config/orchestration/provider logic and should first write or update a failing test, make it pass, and refactor safely.
---

# Open Fusion TDD Cycle

## Required Context

Before changing behavior, read:

- `docs/PRD.md`
- the spec that owns the behavior being changed;
- the ADRs referenced by that spec;
- existing tests near the affected code.

Use the domain skill too when relevant, for example `open-fusion-nestjs-api`, `open-fusion-config-json`, `open-fusion-llm-orchestration`, `open-fusion-provider-adapters`, or `open-fusion-ops-guardrails`.

## TDD Loop

Follow this loop for behavior changes:

1. Define the observable behavior in one sentence.
2. Add or update the smallest test that should fail for the current code.
3. Run the targeted test and confirm the expected failure.
4. Implement the smallest production change that can pass the test.
5. Run the targeted test and confirm it passes.
6. Refactor for clarity, SOLID boundaries, and DRY only while tests stay green.
7. Run the relevant wider test set before finishing.

If a failing test cannot be demonstrated because the project is not scaffolded yet, create the test file and document the command that should run once tooling exists.

## Test First Rules

- Do not start with production implementation for new behavior.
- Prefer one behavior assertion over broad snapshot tests.
- Prefer deterministic fakes over live LLM/provider calls.
- Capture regressions with a test before fixing bugs.
- Keep test names behavioral: describe what the system should do, not how it does it.
- When refactoring only, keep behavior tests unchanged unless they expose implementation details.

## Open Fusion TDD Targets

Prioritize tests around:

- OpenAI-compatible request and response envelopes;
- streaming `[DONE]` behavior;
- JSON config validation and secret resolution;
- route and model authorization;
- orchestration limits and blocked delegate models;
- provider error normalization;
- request id, redaction, timeout, and auth behavior.

## Refactor Phase

During refactor:

- remove duplication created to pass the test;
- improve names and module boundaries;
- keep controllers thin;
- preserve adapter boundaries;
- keep secrets and provider details isolated;
- rerun the focused tests after each meaningful refactor.

## Completion Criteria

A TDD task is done only when:

- at least one relevant test protects the behavior;
- the test failed before the implementation or the limitation is explicitly stated;
- targeted tests pass;
- broader checks have been run or the reason they could not run is clear.
