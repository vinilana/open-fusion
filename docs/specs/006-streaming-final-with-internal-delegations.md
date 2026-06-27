# Spec 006: Routed Streaming with Internal Delegations

## Status

Draft - next for implementation

## Objective

Extend `streamFinal()` to support `stream: true` responses where the backend classifies the request capability, builds and validates an internal agent execution plan, runs multiple independent agent tasks in parallel when dependencies allow, resolves a final execution target, and streams only the final answer through the OpenAI-compatible SSE contract.

The implementation must avoid making long-running delegated work depend on a single non-streaming `generate()` call. The orchestrator may plan, refine tasks, and propose internal agent work, but the backend must enforce model selection, allowed delegates, delegation limits, dependency order, parallel execution bounds, and final response streaming.

## Context

The gateway must hide internal orchestration details. Even when the client requests `stream: true`, tool calling events, operational prompts, internal agent outputs, dependency graphs, and routing metadata must not appear in the public SSE stream.

When the response is routed to a delegate model, that model's final content becomes the client-visible answer. When the response uses `orchestrator_fallback`, the configured orchestrator model becomes the final streaming target, but this is still an explicit backend-selected target rather than direct reuse of planning text.

Trusting only the orchestrator prompt to choose `delegate_llm` is not sufficient. Orchestrator models can answer directly, choose the wrong model, omit useful parallel subtasks, or request unauthorized targets. The backend must deterministically enforce capability routing, target validation, parallel execution constraints, and final target selection.

The text returned by the orchestrator planning call is never, by itself, the final answer for a routed streaming request. After planning, the backend must always resolve an explicit final target: an allowed delegate model or the operational fallback to the route's configured orchestrator model.

## Terms

- Orchestrator: the route's configured model used for request understanding, planning, optional disambiguation, and task refinement.
- Delegate model: an internal model with role `delegate` and one or more declared capabilities.
- Agent task: one backend-controlled model invocation assigned to exactly one delegate model or, for the final response only, `orchestrator_fallback`.
- Agent phase: a logical execution group in the internal plan. Phases may run sequentially or overlap when no data dependency exists between their tasks.
- Dependency: an explicit requirement that one agent task must finish before another agent task or the final target can use its output.
- Execution graph: the backend-normalized directed acyclic graph of internal agent tasks, dependencies, and one final target.
- Final target: the single model invocation whose streamed output is exposed to the client.
- `orchestrator_fallback`: an explicit final target that uses the route's configured orchestrator model when a specialized capability has no exact allowed delegate.

## Canonical Capabilities

For internal routing, the gateway recognizes only these capabilities on delegate models:

| Capability | Use                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `plan`     | Planning, architecture, task decomposition, roadmaps, and implementation strategy.                                               |
| `code`     | Implementation, programming, debugging, scripts, refactoring, and executable code generation.                                    |
| `review`   | Critical review, audit, quality analysis, security analysis, or correctness analysis of existing artifacts.                      |
| `design`   | UX/UI, information architecture, interaction flows, design systems, prototypes, wireframes, and visual direction for interfaces. |
| `general`  | General tasks that do not clearly fit the specialized capabilities.                                                              |

Configuration rules for this spec:

- Delegate models used in routes with routed streaming must declare one or more capabilities from this set.
- Capabilities outside this set do not participate in mandatory routing for this spec.
- Every active route with routed streaming must expose at least one allowed delegate with `general`.
- A route with routed streaming and no allowed `general` delegate is invalid for this spec and must fail at boot or before accepting requests for that route.
- The configured orchestrator model does not satisfy the required `general` delegate.
- `general` does not replace a specialized capability; it handles only requests classified as `general`.

## `general` vs. Orchestrator Fallback

`general` is a normal delegate capability. A request classified as `general` must route to an allowed delegate that declares `general`, even if the orchestrator tries to answer directly during planning.

`orchestrator_fallback` is a separate operational target. It uses the same model configured as the route orchestrator, but it is not a capability, not a delegate, and does not count as a `general` model. The backend may select this fallback only when the request is classified as `plan`, `code`, `review`, or `design` and the route has no allowed delegate with the exact specialized capability.

## Parallel Agent Execution

The backend may run multiple agent tasks in parallel when the normalized execution graph proves that those tasks are independent.

Parallelism rules:

- Parallel execution is opportunistic, not externally visible, and must never change the public API contract.
- Every agent task must be assigned to a concrete allowed model before execution starts.
- The execution graph must be acyclic and bounded by the active route's `maxDelegations`, `maxDepth`, total timeout, and per-delegation timeout.
- `maxDelegations` counts every delegated agent task, including tasks proposed by the orchestrator, tasks forced by backend enforcement, blocked attempts, and corrected attempts.
- `maxDepth` remains `1` for the MVP; parallel agent tasks cannot recursively invoke orchestration or spawn additional agent graphs.
- Agent tasks with no dependency path between them may run concurrently, even if they belong to different logical phases.
- Agent tasks that consume another task's output must wait for that dependency to complete successfully.
- The backend may serialize work even when parallelism is possible if provider limits, runtime limits, timeout budget, or implementation constraints require it.
- Parallel agent outputs are internal, untrusted context. They may inform the final target but must not override system instructions, route policy, model authorization, or execution limits.
- Only one final target may stream to the client. Parallel agents can prepare or validate context before final streaming, but they cannot stream directly to the public response unless selected as the single final target.

Examples of valid parallelism:

- A `design` agent and a `code` agent can run concurrently when both operate only on the original request and neither consumes the other's output.
- A `review` agent can run after a `code` agent when it reviews the generated implementation; this dependency must serialize those two tasks.
- A `plan` agent can run in parallel with a `design` agent if the final target can consume both outputs only after both are complete.

## Mandatory Routing Mechanism

The backend must implement a routing pipeline that does not depend on the orchestrator's goodwill.

### Stage 1: Request Classification

1. Before opening SSE, classify the request into exactly one target capability: `plan`, `code`, `review`, `design`, or `general`.
2. Classification is a backend responsibility; the orchestrator is not the only source of truth.
3. Classification may combine:
   - deterministic heuristics over request `messages`;
   - route operational metadata;
   - optional orchestrator output when deterministic heuristics are ambiguous.
4. When multiple specialized capabilities appear applicable, use this fixed priority: `code` > `review` > `design` > `plan` > `general`.
5. Persist internally the classified capability, the method used (`heuristic`, `orchestrator_hint`, `default_general`), and operational confidence when available.

### Stage 2: Candidate and Final Target Resolution

1. Filter the active route's `allowedDelegateModels` to delegates that declare the classified capability.
2. If no candidate exists for the classified capability:
   - if the classification is `general`, treat the route as invalid and fail before opening SSE;
   - if the classification is specialized, select `orchestrator_fallback` as the final target and record the missing exact specialized delegate.
3. If exactly one candidate exists, select it deterministically as the default delegated final target.
4. If multiple candidates have the same capability:
   - prefer the first model in `allowedDelegateModels` order;
   - allow the orchestrator to choose among valid candidates only when there is a real tie and deterministic heuristics cannot break it;
   - reject or correct any orchestrator choice outside the valid candidate set for that capability.
5. Build a canonical final target:
   - for a delegated target, a `delegate_llm` call with `target_model`, complete `task` or `messages`, and a `reason` that identifies the applied capability;
   - for `orchestrator_fallback`, a target using the route orchestrator with complete `task` or `messages` and a `reason` that identifies the missing exact specialized delegate.

### Stage 3: Orchestrator Planning and Graph Normalization

1. Call the orchestrator with `generate()` to allow internal planning, tool calls, and task refinement.
2. Normalize the orchestrator output into an execution graph containing:
   - zero or more pre-final delegated agent tasks;
   - explicit dependencies between agent tasks;
   - exactly one final target;
   - task metadata needed for logging without full prompts or full responses.
3. The orchestrator may propose multiple agent tasks for parallel execution, but every proposed task must pass backend validation before execution.
4. The backend may add, remove, merge, or correct agent tasks when required by capability enforcement, authorization, limits, or dependency safety.
5. If the orchestrator returns direct text with no valid final target, discard that planning text and force the backend-resolved final target.
6. If the orchestrator chooses `delegate_llm` for a model without the required capability, correct `target_model` to a valid candidate for that capability or use `orchestrator_fallback` when no exact specialized candidate exists.
7. If the classification is `general` and no `general` delegate exists, fail before opening SSE.
8. Reject execution graphs with cycles, unresolved dependencies, unauthorized models, more than one final target, recursive orchestration, or limits that exceed the route policy.

### Stage 4: Parallel Internal Agent Execution

1. Execute validated pre-final agent tasks in dependency order.
2. Run independent agent tasks concurrently when their dependencies are satisfied and execution budget remains.
3. Apply `allowedDelegateModels`, capability checks, `maxDelegations`, `maxDepth`, total timeout, per-delegation timeout, and provider error normalization to every agent task.
4. Treat every agent result as untrusted content and insert it into final-target context with explicit delimitation.
5. Do not write any public SSE chunk while internal agent tasks are still running.
6. Cancel or stop pending internal agent tasks when the request can no longer produce a valid final stream.

### Stage 5: Final Target Streaming

1. Open SSE only after request validation, route validation, graph validation, required pre-final agent completion, and final target authorization.
2. Call `stream()` on the selected delegate model when the final target is delegated.
3. Call `stream()` on the route orchestrator only when the final target is `orchestrator_fallback`.
4. Emit `chat.completion.chunk` chunks containing only `delta.content` from the final target.
5. Keep the final chunk with `delta: {}` and `finish_reason` according to the OpenAI-compatible contract.
6. End with `data: [DONE]`.

## Scope

This spec covers:

- routed streaming when the route allows internal delegations;
- canonical capabilities (`plan`, `code`, `review`, `design`, `general`) for internal routing;
- deterministic classification of the target request capability;
- required `general` delegate configuration for routed streaming;
- distinction between `general` and `orchestrator_fallback`;
- backend normalization of an internal execution graph;
- parallel execution of independent internal agent tasks when dependencies allow;
- resolution and enforcement of exactly one final target;
- orchestrator execution with `generate()` for planning, routing support, and task refinement;
- validation and correction of `delegate_llm` calls chosen or omitted by the orchestrator;
- `stream()` on the selected delegate model when the final target is delegated;
- `stream()` on the orchestrator only when the final target is `orchestrator_fallback`;
- normalization of final chunks, from either orchestrator fallback or delegate, to Chat Completions SSE;
- failure behavior before and after the public stream starts.

This spec does not cover:

- public exposure of tool calling events in the stream;
- public streaming of multiple internal agents in a single response;
- streaming internal orchestration traces;
- recursive agent graphs or nested orchestration;
- changes to the public `/v1/chat/completions` contract.

## Required Flow

### Phase 1: Request Validation and Route Resolution

1. Validate the OpenAI-compatible request before starting SSE.
2. Resolve the active route, orchestrator, delegate models, limits, and `streamFinalOnly` policy.
3. Validate that routes with routed streaming expose at least one allowed `general` delegate.
4. Reject invalid requests with an OpenAI-compatible HTTP error before writing any chunk.

### Phase 2: Capability Classification and Target Resolution

1. Identify whether the route can use `delegate_llm`.
2. Classify the request as `plan`, `code`, `review`, `design`, or `general`.
3. Resolve candidates in `allowedDelegateModels` that declare the classified capability.
4. Resolve the expected final target: exact-capability delegate or `orchestrator_fallback` for specialized capabilities with no exact candidate.
5. Build the internal orchestrator context with delegation limits, depth, timeouts, valid delegates by capability, and explicit fallback when applicable.
6. Instruct the orchestrator to act as a router and planner for streaming requests, including the classified capability, valid targets, and dependency requirements.
7. Prepare forced delegation or explicit fallback when a final target is already resolved and the orchestrator has not selected a valid target.
8. Ensure no intermediate decision writes to the public stream.

### Phase 3: Orchestrator Planning and Enforcement

1. Call the orchestrator with `generate()` to allow internal tool calls and planning.
2. Normalize and validate the execution graph.
3. Apply post-response enforcement according to the classified capability and resolved final target.
4. Ensure exactly one final target, even if the orchestrator answered directly.
5. Validate that all proposed agent tasks target allowed delegate models with compatible capabilities.
6. Validate `target_model` against `allowedDelegateModels` when the final target is delegated; when the final target is `orchestrator_fallback`, validate that the model is exactly `route.orchestrator`.
7. Reject multiple final targets before opening SSE.
8. Reject cycles, unresolved dependencies, recursive orchestration, and limit violations before opening SSE.
9. When the classification is `general`, require a `general` delegate and block direct orchestrator text as final output.

### Phase 4: Parallel Internal Agent Execution

1. Execute pre-final agent tasks only after graph validation.
2. Run independent agent tasks in parallel when dependency and budget checks allow it.
3. Serialize tasks that depend on another agent's output.
4. Collect results, status, latency, usage, finish reason, and normalized errors for each internal agent task when available.
5. Redact and delimit internal agent outputs before adding them to final-target context.
6. Stop or cancel remaining internal agent tasks if the request cannot still produce a valid final stream.
7. Keep the public stream closed until all required pre-final agent tasks finish successfully.

### Phase 5: Final Response Streaming

1. Open SSE only after validation, routing, authorization, graph enforcement, and required pre-final agent completion.
2. Call `stream()` on the selected delegate when the final target is delegated.
3. Call `stream()` on the route orchestrator only when the final target is `orchestrator_fallback`.
4. Emit `chat.completion.chunk` chunks containing only `delta.content` from the final response.
5. Keep the final chunk with `delta: {}` and `finish_reason` according to the OpenAI-compatible contract.
6. End with `data: [DONE]`.

### Phase 6: Observability and Usage

1. Log the orchestrator decision, classified capability, classification method, normalized execution graph summary, parallel agent execution summary, enforcement applied, and final stream with `requestId`, route, public model, internal models, latency, status, and usage when available.
2. Aggregate token usage when providers return this information.
3. Do not log full prompts, full responses, bearer tokens, API keys, authorization headers, raw internal traces, or raw execution graphs by default.
4. Differentiate validation failures, routing failures, graph validation failures, delegation failures, fallback usage, and SSE emission failures in structured logs.

## Rules

- `streamFinalOnly` remains the default policy.
- The client receives only the final answer in SSE.
- In routed streaming, the orchestrator acts as planner, router assistant, and delegated-task editor; the backend enforces target selection, graph validity, authorization, limits, and parallel execution safety.
- The final target chosen after enforcement produces the response streamed to the client.
- Delegations must be validated before any provider call and before the public stream starts.
- A streaming response may run multiple internal delegated agent tasks before final streaming, but it may have only one final target.
- Independent internal agent tasks may run in parallel when their dependencies allow it.
- Requests classified as `plan`, `code`, `review`, or `design` must use a delegate with the same capability when an allowed exact candidate exists on the active route.
- Requests classified as `general` must use an allowed delegate that declares `general`.
- The fallback to the orchestrator model may be used only for specialized capabilities without an exact allowed delegate and must be recorded as a target distinct from `general`.
- Direct text returned by the planning `generate()` call cannot be transmitted as the final answer.
- Capabilities outside `plan`, `code`, `review`, `design`, and `general` do not participate in enforcement for this spec.
- If a failure happens before the first SSE chunk, the gateway must return an OpenAI-compatible HTTP error.
- If a failure happens after the stream starts, the gateway must close the stream in a controlled way and log the failure internally.
- The orchestrator cannot delegate to models outside the active route.
- Controllers must not import provider SDKs or execute orchestration logic.
- Provider adapters remain the only owners of Vercel AI SDK and provider details.

## Failure Behavior

- Missing `general` delegate on a route with routed streaming must invalidate that route before opening SSE.
- Delegation to a model that is unauthorized or lacks the required capability must be corrected to a valid target or blocked before calling providers and before opening SSE.
- Ambiguous classification must fall to `general` only when no specialized heuristic applies consistently.
- Execution graphs with cycles, unresolved dependencies, more than one final target, recursive orchestration, or route-limit violations must be rejected before opening SSE.
- A required pre-final agent failure before the first chunk must prevent stream startup unless backend policy can still resolve a valid final target without using that failed result.
- Routing timeout before the first chunk must prevent stream startup.
- Provider failure before stream startup must be normalized to an OpenAI-compatible HTTP error.
- Provider failure during the final stream, whether from orchestrator fallback or delegate, must close SSE without leaking stack traces, credentials, prompts, raw agent outputs, or internal traces.
- Pending parallel agent tasks must be canceled or ignored once a terminal request failure is known.

## Acceptance Criteria

- `streamFinal()` classifies the request as `plan`, `code`, `review`, `design`, or `general` before opening SSE.
- `streamFinal()` executes the orchestrator with `generate()`, normalizes an execution graph, and applies deterministic enforcement after the response.
- Routes with routed streaming and no `general` delegate are rejected before SSE starts.
- When an allowed delegate exists for the classified capability, `streamFinal()` uses `stream()` directly on that delegate as the final target, even if the orchestrator returned direct text or chose a model without the correct capability.
- When the orchestrator chooses `delegate_llm` correctly for the final target, `streamFinal()` uses `stream()` directly on the validated delegate model.
- When classification is `general`, `streamFinal()` uses an allowed `general` delegate and never treats planning text as the final answer.
- When classification is specialized and no allowed delegate has the exact capability, `streamFinal()` uses the route orchestrator as `orchestrator_fallback` without confusing that path with `general`.
- `streamFinal()` can execute multiple independent internal agent tasks in parallel before final streaming when dependencies and route limits allow it.
- Dependent agent tasks are serialized according to the validated execution graph.
- No public chunk contains internal tool calls, delegation traces, execution graph details, internal prompts, raw delegated results, or parallel-agent metadata.
- Streaming requests with delegation accumulate `delta.content` correctly on the client and end with `[DONE]`.
- Errors before stream startup return an OpenAI-compatible error envelope.
- Errors after stream startup close SSE in a controlled way and produce structured logs.
- Delegations respect `allowedDelegateModels`, `maxDelegations`, `maxDepth`, total timeout, and per-delegation timeout.
- Tests cover capability classification, required `general` delegate configuration, enforcement when the orchestrator omits `delegate_llm`, correction when it chooses the wrong delegate, explicit orchestrator fallback, routed streaming to a delegate, parallel independent agent execution, serialization of dependent agents, blocked delegation, rejection of multiple final targets, rejection of invalid graphs, timeout before stream startup, and failure during final stream.

## Expected Tests

- Unit test for `OrchestrationService.streamFinal()` using explicit orchestrator fallback when no exact specialized delegate exists.
- Unit test for `OrchestrationService.streamFinal()` with one routed delegation and direct streaming from the delegate.
- Unit test for capability classification for `plan`, `code`, `review`, `design`, and `general` requests.
- Unit test for `OrchestrationService.streamFinal()` enforcing each capability when a corresponding allowed delegate exists.
- Unit test ensuring routes with routed streaming and no `general` delegate are rejected before opening SSE.
- Unit test ensuring `general` requests use a `general` delegate even when the orchestrator answers directly.
- Unit test ensuring orchestrator fallback is recorded as a final target distinct from `general`.
- Unit test ensuring `target_model` is corrected when the orchestrator chooses a delegate without the required capability.
- Unit test ensuring independent pre-final agent tasks execute in parallel when no dependencies exist.
- Unit test ensuring dependent agent tasks are serialized when one consumes another's output.
- Unit test ensuring `maxDelegations` counts parallel delegated agent tasks and blocks excess tasks before provider calls.
- Unit test ensuring invalid execution graphs with cycles or unresolved dependencies are rejected before opening SSE.
- Unit test ensuring multiple final targets are rejected before opening SSE.
- Unit test for blocking `delegate_llm` outside `allowedDelegateModels` before provider calls.
- Unit or integration test ensuring internal tools, execution graph details, and parallel-agent metadata do not appear in SSE chunks.
- E2E test for `/v1/chat/completions` with `stream: true`, validating `delta.content` accumulation, final chunk `finish_reason`, and `data: [DONE]`.
- Test for failure before the first chunk returning an OpenAI-compatible HTTP error.
- Test for failure after final stream startup ensuring controlled closure and no sensitive detail leakage.

## Implementation Order

1. Introduce deterministic capability classification and final target resolution.
2. Validate that routed streaming routes have a `general` delegate and that the orchestrator does not count as that delegate.
3. Introduce an internal execution graph representation for pre-final agent tasks, dependencies, and one final target.
4. Add graph validation for authorization, capability compatibility, acyclic dependencies, one final target, `maxDelegations`, `maxDepth`, and timeout budget.
5. Strengthen routed streaming tests with orchestration and provider fakes.
6. Separate classification, planning with `generate()`, graph normalization, enforcement, parallel internal execution, and final streaming in the orchestration service.
7. Replace the ad hoc `coding` fallback with generic enforcement for `plan`, `code`, `review`, `design`, and `general`.
8. Add controlled parallel execution for independent pre-final agent tasks, with cancellation on terminal failure.
9. Ensure delegate-stream or orchestrator-fallback payloads cannot accidentally enable new delegations.
10. Update chunk normalization and logs to distinguish classification, graph validation, enforcement, routing, delegation, parallel agent execution, orchestrator fallback, and final streaming.
11. Run targeted tests, broader relevant suite, typecheck, lint, and formatting.

## Related ADRs

- [ADR 0002](../adrs/0002-openai-compatible-public-api.md)
- [ADR 0003](../adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)
