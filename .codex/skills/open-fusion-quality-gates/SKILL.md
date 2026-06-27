---
name: open-fusion-quality-gates
description: Verify Open Fusion changes before completion. Use when Codex is finishing a task, preparing a PR, reviewing readiness, or checking software quality gates such as tests, lint, typecheck, formatting, docs alignment, security redaction, SOLID/DRY risks, and residual implementation risk.
---

# Open Fusion Quality Gates

## Required Context

Before finalizing a change, inspect:

- modified files;
- relevant specs and ADRs;
- existing package scripts once a package manifest exists;
- test output from the current task.
- recent review/audit reports when the task is addressing review feedback or preventing known regressions.

Use this skill together with `open-fusion-code-quality` when reviewing design risks.

## Minimum Gate

A change should not be considered done until these are true or explicitly reported as not runnable:

- targeted tests pass;
- relevant broader tests pass;
- typecheck passes;
- lint passes;
- formatting is consistent;
- docs/specs/ADRs are updated when behavior or decisions changed;
- public API compatibility is preserved or the breaking change is documented;
- secrets are not logged, returned, or committed;
- new provider/network behavior is mocked unless a live integration run was intentional.

## Suggested Commands

Discover commands from the repo before inventing them:

- inspect `package.json`;
- inspect workspace tooling files;
- use package manager already present in lockfiles.

Typical commands once available:

```bash
npm test
npm run test:e2e
npm run lint
npm run typecheck
```

Adapt to `pnpm`, `yarn`, or `npm` based on the repository.

## Review Checklist

Check:

- Does a failing test protect the changed behavior?
- Is the smallest responsible module changed?
- Are controllers thin?
- Are provider details isolated behind adapters?
- Are config and secrets handled only by config/secret services?
- Are OpenAI-compatible envelopes stable?
- Are streaming chunks valid and terminated?
- Are timeouts and limits enforced by backend code?
- Is duplicate logic removed or intentionally tolerated?
- Are errors useful without exposing sensitive data?

Known regression checks from PR review audit:

- numeric request validators reject non-finite numbers;
- payload, message-count, and message-content limits are enforced where required;
- shared client/request domain shapes are not duplicated across services and Express typings;
- provider-supplied tool calls and delegate messages are runtime-validated before typed use;
- internal gateway misconfiguration maps to `internal_error`, not `provider_error`;
- validation/model/tool-policy failures produce structured failure logs;
- `depends_on: []` does not misclassify final delegate calls;
- parallel delegation failures cancel in-flight work or document/test ignored late results;
- implemented specs and PRD links do not still say "next", "draft", or "upcoming";
- package runtime requirements such as `engines.node` are explicit when dependencies require them;
- tests restore `process.env` by mutating the existing object.

## Risk Reporting

When finishing, report:

- checks run;
- checks not run and why;
- any residual risk;
- files changed at a high level.

Do not claim full verification if only static edits or documentation checks ran.
