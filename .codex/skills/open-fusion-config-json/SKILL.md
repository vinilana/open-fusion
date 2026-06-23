---
name: open-fusion-config-json
description: Implement and maintain Open Fusion's single JSON configuration system. Use when Codex works on config schema, loading, validation, environment variable secret resolution, provider/model/route/auth configuration, default config examples, config tests, or migrations for the Open Fusion LLM gateway.
---

# Open Fusion Config JSON

## Required Context

Before editing configuration code or examples, read:

- `docs/PRD.md`
- `docs/specs/003-single-json-configuration.md`
- `docs/adrs/0004-single-json-configuration.md`

Read provider and orchestration specs when config fields affect those areas:

- `docs/specs/002-llm-orchestration-routing.md`
- `docs/specs/004-provider-adapters-openrouter.md`
- `docs/specs/006-observability-resilience-security.md`

## Configuration Contract

The MVP uses one JSON file loaded at boot. The config path comes from `OPEN_FUSION_CONFIG`, with `./config/open-fusion.config.json` as the fallback candidate.

The application must fail before listening for HTTP if required config is invalid.

## Schema Responsibilities

Validate at least:

- supported `version`;
- known provider `type`;
- model references to existing providers;
- route references to existing orchestrator models;
- delegate model references to existing models with delegate role;
- `maxDepth` equal to `1` for MVP;
- positive timeout and delegation limits;
- auth key entries with resolvable secret references.

Prefer a typed schema validator that produces field paths in errors.

## Secrets

- Treat `*Env` fields as references to environment variables.
- Resolve secrets at boot or through a secret resolver service.
- Never log resolved secret values.
- Never return resolved secret values from debug, health, models, or error responses.
- Redact `apiKey`, `token`, `authorization`, and configured redaction keys.

## Design Rules

- Keep raw parsed JSON separate from validated runtime config.
- Expose immutable typed config objects to the rest of the app.
- Avoid reading `process.env` outside config/bootstrap/secret resolution code.
- Do not scatter provider-specific config parsing through orchestration or controllers.
- Add migrations only after introducing a new config `version`.

## Testing

Cover valid minimal config, missing env secret, unknown provider, invalid route reference, invalid delegate model, and redaction behavior.
