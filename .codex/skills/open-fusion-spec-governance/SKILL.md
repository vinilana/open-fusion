---
name: open-fusion-spec-governance
description: Enforce Open Fusion specification governance when Codex changes PRD, specs, ADRs, AGENTS.md, or introduces behavior that needs documentation; use to decide whether to update the active spec, create a new spec, or avoid changing implemented specs.
---

# Open Fusion Spec Governance

## Core Rule

Do not add new requirements to specs that already govern implemented work.

When behavior, contracts, architecture, configuration, or operational requirements change:

1. If the behavior belongs to the spec currently being implemented, document it in that active spec.
2. If the behavior belongs to a completed or already implemented spec, create a new numbered spec for the new requirement instead of editing the old spec.
3. If the change is a durable architectural decision or contradicts an accepted ADR, create a new ADR or superseding ADR.
4. Update `docs/PRD.md` only when adding a new spec or ADR link, or when product scope changes.

## Allowed Edits To Existing Implemented Specs

Existing implemented specs may be edited only for:

- typo or formatting fixes that do not change requirements;
- broken link fixes;
- status or roadmap corrections after the implementation lands, when they only reflect reality and add no new requirement;
- explicit user-approved corrections to historical text.

Do not use an implemented spec as a convenient place to document a new field, flag, route, policy, behavior, or acceptance criterion.

## Required Workflow

Before editing docs:

1. Identify the owning spec and whether it is the active implementation target.
2. Check whether the proposed text is a new requirement or only a correction.
3. If it is a new requirement and the owning spec is already implemented, create the next numbered spec under `docs/specs/`.
4. Add the new spec link to `docs/PRD.md`.
5. Keep code, tests, and docs aligned in the same change set.

## Review Checklist

- Did this change add a requirement to an old implemented spec?
- Should this be in the current active spec instead?
- Should this be a new spec or ADR?
- If a spec moved from planned to implemented, did its Status and the `docs/PRD.md` reference stop saying it is next/upcoming?
- Is `docs/PRD.md` updated when a new spec or ADR was added?
- Are tests covering the newly documented requirement?
