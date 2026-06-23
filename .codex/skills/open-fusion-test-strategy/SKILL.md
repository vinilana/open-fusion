---
name: open-fusion-test-strategy
description: Design the right testing approach for Open Fusion. Use when Codex needs to choose, write, restructure, or review unit, integration, contract, e2e, streaming, provider-adapter, config, orchestration, or security tests for the Open Fusion LLM gateway.
---

# Open Fusion Test Strategy

## Required Context

Read the owning spec before designing tests:

- API behavior: `docs/specs/001-openai-compatible-api.md`
- Orchestration: `docs/specs/002-llm-orchestration-routing.md`
- Config: `docs/specs/003-single-json-configuration.md`
- Providers: `docs/specs/004-provider-adapters-openrouter.md`
- Streaming/tools: `docs/specs/005-streaming-tools-response-normalization.md`
- Ops/security: `docs/specs/006-observability-resilience-security.md`

## Test Pyramid

Prefer this order:

1. Unit tests for pure validation, mapping, policy, and normalization logic.
2. Integration tests for NestJS modules, guards, filters, config loading, and service wiring.
3. Contract tests for public OpenAI-compatible envelopes, provider adapter behavior, and streaming chunks.
4. E2E tests for critical client flows through HTTP.
5. Live provider tests only when explicitly configured and cost-controlled.

## What To Mock

Mock or fake by default:

- Vercel AI SDK model calls;
- OpenRouter/network calls;
- time, ids, and environment variables;
- streaming token sources;
- provider failures and timeouts.

Do not mock the code under test. Mock at external boundaries.

## Required Coverage Areas

API:

- valid chat completion request;
- invalid request envelope;
- unknown public model;
- auth failure;
- OpenAI-style error body;
- streaming chunk format and `[DONE]`.

Config:

- valid minimal config;
- unknown provider type;
- missing env secret;
- invalid model/provider reference;
- invalid route/orchestrator reference;
- secret redaction.

Orchestration:

- direct orchestrator response;
- allowed delegation;
- blocked delegation;
- max delegation limit;
- delegate timeout;
- final-only streaming.

Providers:

- non-streaming success;
- streaming success;
- tool-capable path;
- unsupported capability;
- provider timeout;
- provider error normalization.

Ops:

- request id propagation;
- structured log fields;
- redaction;
- payload limits;
- health checks without paid provider calls.

## Test Quality

- Assert observable behavior, not private implementation.
- Keep fixtures small and named.
- Avoid snapshots for dynamic OpenAI-compatible envelopes unless normalized.
- Use builders/helpers only after duplication is real.
- Make failures diagnostic: include model/route/status expectations clearly.
