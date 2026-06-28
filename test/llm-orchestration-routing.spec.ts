import { OpenAiHttpError } from "../src/errors/openai-http-error";
import { GatewayConfigService } from "../src/config/gateway-config.service";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
  LlmRoutingDecisionRequest,
  LlmStreamChunk,
  ROUTING_DECISION_VALIDATION_PUBLIC_MESSAGE,
  RoutingDecision,
} from "../src/orchestration/llm-generation.port";
import { OrchestrationService } from "../src/orchestration/orchestration.service";
import { ChatCompletionRequest } from "../src/v1/openai-types";
import { minimalConfig, validEnv } from "./support/gateway-config.fixture";

const routeModel = "route/default";

class ScriptedGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly routingDecisionRequests: LlmRoutingDecisionRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];
  private readonly results: Array<
    LlmGenerateResult | Promise<LlmGenerateResult>
  >;
  private readonly routingDecisions: Array<
    RoutingDecision | Promise<RoutingDecision>
  >;
  private readonly streamResults: ScriptedStreamResult[];

  constructor(
    results: Array<LlmGenerateResult | Promise<LlmGenerateResult>>,
    streamResults: Array<string[] | ScriptedStreamResult> = [],
    routingDecisions: Array<RoutingDecision | Promise<RoutingDecision>> = [],
  ) {
    this.results = [...results];
    this.routingDecisions = [...routingDecisions];
    this.streamResults = streamResults.map((result) =>
      Array.isArray(result) ? { chunks: result } : result,
    );
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) {
      throw new Error("Unexpected generation request.");
    }
    return next;
  }

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    this.routingDecisionRequests.push(request);
    const next = this.routingDecisions.shift();
    return next ?? createDefaultRoutingDecision(request);
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    this.streamRequests.push(request);
    const next = this.streamResults.shift();
    if (!next) {
      throw new Error("Unexpected streaming request.");
    }

    for (const chunk of next.chunks) {
      yield {
        content: chunk,
        finishReason: null,
      };
    }
    yield {
      content: "",
      finishReason: next.finishReason ?? "stop",
      usage: next.usage,
    };
  }
}

interface ScriptedStreamResult {
  chunks: string[];
  finishReason?: LlmGenerateResult["finishReason"];
  usage?: LlmGenerateResult["usage"];
}

class CapturingOperationalLogger {
  readonly events: unknown[] = [];

  logLlmInvocation(event: unknown): void {
    this.events.push(event);
  }

  logRouting(event: unknown): void {
    this.events.push(event);
  }

  logChatCompletion(): void {
    throw new Error("Chat completion logs are not expected in this unit test.");
  }

  logHttpRequest(): void {
    throw new Error("HTTP request logs are not expected in this unit test.");
  }

  normalizeError(error: unknown) {
    if (error instanceof OpenAiHttpError) {
      return {
        type: error.type,
        code: error.code,
        param: error.param,
        status: error.status,
      };
    }

    return {
      type: "server_error",
      code: "internal_error",
      param: null,
      status: 500,
    };
  }
}

interface PreFinalTaskFixture {
  id: string;
  targetModel: string;
  task: string;
  dependencies: string[];
}

class ParallelPreFinalGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly routingDecisionRequests: LlmRoutingDecisionRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];
  maxConcurrentDelegates = 0;
  private currentDelegates = 0;

  constructor(private readonly tasks: PreFinalTaskFixture[]) {}

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    this.routingDecisionRequests.push(request);
    const delegate = request.delegateModels[0];
    return {
      final_target: {
        type: "delegate",
        target_model: delegate.id,
        matched_capability: delegate.capabilities[0] ?? "general",
        reason: "Use the first allowed delegate for the final stream.",
      },
      pre_final_tasks: this.tasks.map((task) => ({
        task_id: task.id,
        target_model: task.targetModel,
        matched_capability:
          request.delegateModels.find((model) => model.id === task.targetModel)
            ?.capabilities[0] ?? "general",
        task: task.task,
        depends_on: task.dependencies,
      })),
    };
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);

    if (request.role === "orchestrator") {
      return {
        content: "",
        finishReason: "tool_calls",
        toolCalls: this.tasks.map((task) => ({
          id: `call_${task.id}`,
          name: "delegate_llm",
          arguments: {
            target_model: task.targetModel,
            task: task.task,
            task_id: task.id,
            depends_on: task.dependencies,
            final: false,
          },
        })),
      };
    }

    this.currentDelegates += 1;
    this.maxConcurrentDelegates = Math.max(
      this.maxConcurrentDelegates,
      this.currentDelegates,
    );
    await delay(20);
    this.currentDelegates -= 1;

    return {
      content: `result for ${request.messages[0]?.content ?? "task"}`,
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    this.streamRequests.push(request);
    yield {
      content: "final streamed answer",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    };
  }
}

class SlowFinalStreamGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly routingDecisionRequests: LlmRoutingDecisionRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    this.routingDecisionRequests.push(request);
    return createDefaultRoutingDecision(request);
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);
    return {
      content: "planning text must not be streamed",
      finishReason: "stop",
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    this.streamRequests.push(request);
    await delay(50);
    yield {
      content: "late chunk",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
    };
  }
}

class NeverResolvingRoutingDecisionGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly routingDecisionRequests: LlmRoutingDecisionRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    this.routingDecisionRequests.push(request);
    return new Promise<RoutingDecision>(() => undefined);
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);
    throw OpenAiHttpError.providerError("Generation should not start.");
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    this.streamRequests.push(request);
    throw OpenAiHttpError.providerError("Final stream should not start.");
    yield {
      content: "",
      finishReason: "stop",
    };
  }
}

class CloseAwareFinalStreamGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly routingDecisionRequests: LlmRoutingDecisionRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    this.routingDecisionRequests.push(request);
    return createDefaultRoutingDecision(request);
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);
    throw OpenAiHttpError.providerError("Generation should not start.");
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    this.streamRequests.push(request);
    yield {
      content: "first chunk",
      finishReason: null,
    };
    await new Promise<void>(() => undefined);
  }
}

class GenerateOnlyStreamingPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);
    return {
      content: "planning text must not be streamed",
      finishReason: "stop",
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    this.streamRequests.push(request);
    yield {
      content: "should not stream",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
    };
  }
}

class FailingParallelPreFinalGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly routingDecisionRequests: LlmRoutingDecisionRequest[] = [];
  slowTaskAbortSignal: AbortSignal | undefined;
  slowTaskCompleted = false;

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    this.routingDecisionRequests.push(request);
    return {
      final_target: {
        type: "delegate",
        target_model: "worker.fast",
        matched_capability: "general",
        reason: "Use worker.fast for the final stream.",
      },
      pre_final_tasks: [
        {
          task_id: "fail",
          target_model: "worker.fast",
          matched_capability: "general",
          task: "fail fast",
          depends_on: [],
        },
        {
          task_id: "slow",
          target_model: "worker.fast",
          matched_capability: "general",
          task: "slow pending task",
          depends_on: [],
        },
      ],
    };
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);

    if (request.role === "orchestrator") {
      return {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_fail",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "fail fast",
              task_id: "fail",
              final: false,
            },
          },
          {
            id: "call_slow",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "slow pending task",
              task_id: "slow",
              final: false,
            },
          },
        ],
      };
    }

    if (request.messages[0]?.content === "fail fast") {
      throw OpenAiHttpError.providerError("Pre-final task failed.");
    }

    this.slowTaskAbortSignal = request.abortSignal;
    await delay(150);
    this.slowTaskCompleted = true;
    return {
      content: "slow result that should be ignored",
      finishReason: "stop",
    };
  }

  async *stream(): AsyncIterable<LlmStreamChunk> {
    throw OpenAiHttpError.providerError("Final stream should not start.");
    yield {
      content: "",
      finishReason: "stop",
    };
  }
}

describe("LLM orchestration routing", () => {
  it("calls the configured orchestrator for a direct response", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "direct answer",
        finishReason: "stop",
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const response = await service.run(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    );

    expect(response.content).toBe("direct answer");
    expect(response.finishReason).toBe("stop");
    expect(generation.requests).toHaveLength(1);
    expect(generation.requests[0]).toMatchObject({
      requestId: "req-orchestration-test",
      routeId: "default",
      modelId: "orchestrator.default",
      role: "orchestrator",
      streamFinalOnly: true,
      timeoutMs: expect.any(Number),
    });
    expect(generation.requests[0].timeoutMs).toBeGreaterThan(0);
    expect(generation.requests[0].timeoutMs).toBeLessThanOrEqual(60000);
    expect(generation.requests[0].internalTools).toEqual(["delegate_llm"]);
    expect(generation.requests[0].clientTools).toBeUndefined();
    expect(generation.requests[0].delegateModels).toEqual([
      {
        id: "worker.fast",
        capabilities: ["general", "fast_draft"],
      },
    ]);
  });

  it("delegates to a model allowed by the active route before returning the final answer", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "draft a short answer",
              reason: "fast draft",
            },
          },
        ],
      },
      {
        content: "delegate draft",
        finishReason: "stop",
      },
      {
        content: "final synthesis",
        finishReason: "stop",
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const response = await service.run(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    );

    expect(response.content).toBe("final synthesis");
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "worker.fast",
      "orchestrator.default",
    ]);
    expect(generation.requests[1]).toMatchObject({
      requestId: "req-orchestration-test",
      role: "delegate",
      timeoutMs: 30000,
    });
    expect(generation.requests[2].toolResults).toEqual([
      expect.objectContaining({
        targetModel: "worker.fast",
        task: "draft a short answer",
        status: "success",
        content: "delegate draft",
        finishReason: "stop",
        latencyMs: expect.any(Number),
        untrusted: true,
      }),
    ]);
  });

  it("redacts sensitive delegate content before reinserting it into orchestrator context", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "fetch sensitive detail",
            },
          },
        ],
      },
      {
        content: "provider key sk-secret-value should not be reinjected",
        finishReason: "stop",
      },
      {
        content: "safe final answer",
        finishReason: "stop",
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    await service.run(createRequest(routeModel, "hello"));

    expect(generation.requests[2].toolResults).toEqual([
      expect.objectContaining({
        status: "success",
        content: "provider key sk-[REDACTED] should not be reinjected",
        untrusted: true,
      }),
    ]);
  });

  it("aggregates token usage from orchestrator, delegation, and final synthesis", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "draft",
            },
          },
        ],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
      {
        content: "delegate draft",
        finishReason: "length",
        usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
      },
      {
        content: "final synthesis",
        finishReason: "stop",
        usage: { promptTokens: 6, completionTokens: 7, totalTokens: 13 },
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response.usage).toEqual({
      promptTokens: 11,
      completionTokens: 14,
      totalTokens: 25,
    });
    expect(generation.requests[2].toolResults).toEqual([
      expect.objectContaining({
        finishReason: "length",
        usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
      }),
    ]);
  });

  it("maps final finish reasons without exposing internal tool results", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "truncated answer",
        finishReason: "length",
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response).toMatchObject({
      content: "truncated answer",
      finishReason: "length",
    });
    expect(response).not.toHaveProperty("toolResults");
  });

  it("blocks delegate calls to models that are not allowed by the active route", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.restricted",
              task: "use a hidden model",
            },
          },
        ],
      },
      {
        content: "safe final answer",
        finishReason: "stop",
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response.content).toBe("safe final answer");
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "orchestrator.default",
    ]);
    expect(generation.requests[1].toolResults).toEqual([
      expect.objectContaining({
        targetModel: "worker.restricted",
        status: "error",
        untrusted: true,
      }),
    ]);
    expect(generation.requests[1].internalTools).toBeUndefined();
  });

  it("counts blocked delegate attempts against maxDelegations", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.restricted",
              task: "first hidden model attempt",
            },
          },
          {
            id: "call_2",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.restricted",
              task: "second hidden model attempt",
            },
          },
          {
            id: "call_3",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.restricted",
              task: "third hidden model attempt",
            },
          },
          {
            id: "call_4",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.restricted",
              task: "one too many hidden attempts",
            },
          },
        ],
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(
      service.run(createRequest(routeModel, "hello"), createRuntimeContext()),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        code: "invalid_request",
        param: "maxDelegations",
      } satisfies Partial<OpenAiHttpError>),
    );
    expect(generation.requests).toHaveLength(1);
  });

  it("enforces maxDelegations deterministically", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "first draft",
            },
          },
          {
            id: "call_2",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "second draft",
            },
          },
          {
            id: "call_3",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "third draft",
            },
          },
          {
            id: "call_4",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "one too many",
            },
          },
        ],
      },
      { content: "first", finishReason: "stop" },
      { content: "second", finishReason: "stop" },
      { content: "third", finishReason: "stop" },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(
      service.run(createRequest(routeModel, "hello")),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        code: "invalid_request",
        param: "maxDelegations",
      } satisfies Partial<OpenAiHttpError>),
    );
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "worker.fast",
      "worker.fast",
      "worker.fast",
    ]);
  });

  it("returns delegate timeout as an untrusted tool error to the orchestrator", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "slow task",
            },
          },
        ],
      },
      new Promise<LlmGenerateResult>(() => undefined),
      {
        content: "fallback final answer",
        finishReason: "stop",
      },
    ]);
    const config = new FastTimeoutConfigService();
    const service = new OrchestrationService(config, generation);

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response.content).toBe("fallback final answer");
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "worker.fast",
      "orchestrator.default",
    ]);
    expect(generation.requests[2].toolResults).toEqual([
      expect.objectContaining({
        targetModel: "worker.fast",
        status: "error",
        content: "Delegation to 'worker.fast' timed out.",
        untrusted: true,
      }),
    ]);
    expect(generation.requests[2].internalTools).toBeUndefined();
  });

  it("returns delegate provider failures as untrusted tool errors to the orchestrator", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "provider can fail",
            },
          },
        ],
      },
      Promise.reject(
        OpenAiHttpError.providerError(
          "Provider failed for delegate with sk-provider-secret.",
        ),
      ),
      {
        content: "fallback final answer",
        finishReason: "stop",
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response.content).toBe("fallback final answer");
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "worker.fast",
      "orchestrator.default",
    ]);
    expect(generation.requests[2].toolResults).toEqual([
      expect.objectContaining({
        targetModel: "worker.fast",
        status: "error",
        content: expect.stringContaining("sk-[REDACTED]"),
        untrusted: true,
      }),
    ]);
    expect(generation.requests[2].internalTools).toBeUndefined();
  });

  it("counts timed out delegate attempts against maxDelegations", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "first slow task",
            },
          },
          {
            id: "call_2",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "second slow task",
            },
          },
          {
            id: "call_3",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "third slow task",
            },
          },
          {
            id: "call_4",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "one too many slow tasks",
            },
          },
        ],
      },
      new Promise<LlmGenerateResult>(() => undefined),
      new Promise<LlmGenerateResult>(() => undefined),
      new Promise<LlmGenerateResult>(() => undefined),
    ]);
    const config = new FastTimeoutConfigService();
    const service = new OrchestrationService(config, generation);

    await expect(
      service.run(createRequest(routeModel, "hello"), createRuntimeContext()),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        code: "invalid_request",
        param: "maxDelegations",
      } satisfies Partial<OpenAiHttpError>),
    );
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "worker.fast",
      "worker.fast",
      "worker.fast",
    ]);
  });

  it("streams the delegate selected by the structured routing decision", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [
        {
          chunks: ["delegate ", "streamed ", "answer"],
          usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
        },
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "hello"),
      {
        ...createRuntimeContext(),
        streamFinalOnly: true,
      },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "delegate ", finishReason: null },
      { content: "streamed ", finishReason: null },
      { content: "answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.streamRequests[0]).toMatchObject({
      role: "delegate",
      messages: [{ role: "user", content: "hello" }],
      abortSignal: expect.any(AbortSignal),
    });
    expect(generation.streamRequests[0].internalTools).toBeUndefined();
    expect(generation.streamRequests[0].toolResults).toBeUndefined();
  });

  it("uses the structured routing decision to select a non-canonical capability delegate", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["math delegate answer"]],
      [
        createRoutingDecision({
          targetModel: "worker.math",
          matchedCapability: "math",
        }),
      ],
    );
    const service = new OrchestrationService(
      createMathCapabilityConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "solve 2 + 2"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "math delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.math"],
    );
  });

  it("respects the structured routing decision when delegates share a capability", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["secondary code delegate answer"]],
      [
        createRoutingDecision({
          targetModel: "worker.code.secondary",
          matchedCapability: "code",
        }),
      ],
    );
    const service = new OrchestrationService(
      createDuplicateCodeCapabilityConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "write typescript code for a queue"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "secondary code delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.code.secondary"],
    );
  });

  it("rejects a structured routing decision when the matched capability is not declared by the target", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        createRoutingDecision({
          targetModel: "worker.fast",
          matchedCapability: "code",
        }),
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("repairs a malformed routing decision with a second structured routing request", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["repaired answer"]],
      [
        '{"final_target":{"type":"delegate","target_model":"worker.fast","matched_capability":"general"}}' as unknown as RoutingDecision,
        createRoutingDecision({
          targetModel: "worker.fast",
          matchedCapability: "general",
        }),
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "repaired answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(2);
    expect(generation.routingDecisionRequests[0].abortSignal).toEqual(
      expect.any(AbortSignal),
    );
    expect(generation.routingDecisionRequests[1].abortSignal).toEqual(
      expect.any(AbortSignal),
    );
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
  });

  it("repairs a routing validation error raised by the provider adapter", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["repaired answer"]],
      [
        Promise.reject(
          OpenAiHttpError.providerError(
            ROUTING_DECISION_VALIDATION_PUBLIC_MESSAGE,
          ),
        ),
        createRoutingDecision({
          targetModel: "worker.fast",
          matchedCapability: "general",
        }),
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "repaired answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(2);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
  });

  it("fails before final streaming when a malformed routing decision cannot be repaired", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        '{"final_target":{"type":"delegate","target_model":"worker.fast","matched_capability":"general"}}' as unknown as RoutingDecision,
        {
          final_target: {
            type: "delegate",
            target_model: "worker.fast",
          },
        } as unknown as RoutingDecision,
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });
    expect(generation.routingDecisionRequests).toHaveLength(2);
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("logs malformed routing decisions as failed orchestrator planning", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        '{"final_target":{"type":"delegate","target_model":"worker.fast","matched_capability":"general"}}' as unknown as RoutingDecision,
        {
          final_target: {
            type: "delegate",
            target_model: "worker.fast",
          },
        } as unknown as RoutingDecision,
      ],
    );
    const logger = new CapturingOperationalLogger();
    const service = new OrchestrationService(
      createConfigService(),
      generation,
      logger,
    );

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });

    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "llm_invocation.failed",
          phase: "orchestrator_planning",
          requestId: "req-orchestration-test",
          internalModel: "orchestrator.default",
          status: "error",
          error: expect.objectContaining({
            type: "provider_error",
            code: "provider_error",
            status: 502,
          }),
        }),
      ]),
    );
    expect(logger.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "llm_invocation.completed",
          phase: "orchestrator_planning",
        }),
      ]),
    );
    expect(generation.streamRequests).toHaveLength(0);
    expect(generation.routingDecisionRequests).toHaveLength(2);
  });

  it("fails before final streaming when the generation port cannot return structured routing decisions", async () => {
    const generation = new GenerateOnlyStreamingPort();
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 500,
      code: "internal_error",
    });
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("uses the selected delegate final stream without planning text", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["streamed ", "direct ", "answer"]],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "streamed ", finishReason: null },
      { content: "direct ", finishReason: null },
      { content: "answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.streamRequests[0].internalTools).toBeUndefined();
  });

  it("routes coding streaming requests to the delegate chosen by the structured decision", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["print('hello world')"]],
      [
        createRoutingDecision({
          targetModel: "worker.fast",
          matchedCapability: "code",
        }),
      ],
    );
    const service = new OrchestrationService(
      createCodingConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(
        routeModel,
        "faça um codigo python para printar hello world",
      ),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "print('hello world')", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.streamRequests[0]).toMatchObject({
      role: "delegate",
      messages: [
        {
          role: "user",
          content: "faça um codigo python para printar hello world",
        },
      ],
      system: expect.stringContaining("final client-visible response"),
    });
  });

  it.each([
    ["code", "implemente uma função typescript para somar números"],
    ["review", "revise este patch e encontre riscos de regressão"],
    ["design", "desenhe o fluxo de uma tela de checkout mobile"],
    ["plan", "crie um plano de implementação para autenticação"],
    ["general", "explique a diferença entre HTTP e HTTPS"],
  ])(
    "routes %s streaming requests to the delegate selected by the structured decision",
    async (capability, prompt) => {
      const generation = new ScriptedGenerationPort(
        [],
        [[`${capability} delegate answer`]],
        [
          createRoutingDecision({
            targetModel: `worker.${capability}`,
            matchedCapability: capability,
          }),
        ],
      );
      const service = new OrchestrationService(
        createCanonicalCapabilityConfigService(),
        generation,
      );

      const chunks = [];
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, prompt),
        createRuntimeContext(),
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { content: `${capability} delegate answer`, finishReason: null },
        { content: "", finishReason: "stop" },
      ]);
      expect(generation.routingDecisionRequests).toHaveLength(1);
      expect(generation.requests).toHaveLength(0);
      expect(
        generation.streamRequests.map((request) => request.modelId),
      ).toEqual([`worker.${capability}`]);
      expect(generation.streamRequests[0]).toMatchObject({
        role: "delegate",
        messages: [{ role: "user", content: prompt }],
      });
      expect(generation.streamRequests[0].internalTools).toBeUndefined();
      expect(generation.streamRequests[0].toolResults).toBeUndefined();
    },
  );

  it("uses the plan delegate when the structured decision selects it", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["plan delegate answer"]],
      [
        createRoutingDecision({
          targetModel: "worker.plan",
          matchedCapability: "plan",
        }),
      ],
    );
    const service = new OrchestrationService(
      createCanonicalCapabilityConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(
        routeModel,
        "crie um plano para desenvolver um pagina html com um jogo estilo minecraft",
      ),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "plan delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.plan"],
    );
    expect(generation.streamRequests[0]).toMatchObject({
      role: "delegate",
      messages: [
        {
          role: "user",
          content:
            "crie um plano para desenvolver um pagina html com um jogo estilo minecraft",
        },
      ],
    });
  });

  it("uses the selected plan delegate even when previous assistant content contains code terms", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["plan delegate answer"]],
      [
        createRoutingDecision({
          targetModel: "worker.plan",
          matchedCapability: "plan",
        }),
      ],
    );
    const service = new OrchestrationService(
      createCanonicalCapabilityConfigService(),
      generation,
    );

    const request = {
      model: routeModel,
      messages: [
        {
          role: "assistant" as const,
          content:
            "Aqui está um exemplo em JavaScript com HTML/CSS: function render() { return <div />; }",
        },
        {
          role: "user" as const,
          content: "crie um plano para viajar do brasil para eua",
        },
      ],
    };

    const chunks = [];
    for await (const chunk of service.streamFinal(
      request,
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "plan delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.plan"],
    );
  });

  it("does not use generate text or tool calls to choose the streaming final target", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["code delegate answer"]],
      [
        createRoutingDecision({
          targetModel: "worker.code",
          matchedCapability: "code",
        }),
      ],
    );
    const service = new OrchestrationService(
      createCanonicalCapabilityConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "write typescript code for a queue"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "code delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.code"],
    );
    expect(generation.streamRequests[0].messages).toEqual([
      { role: "user", content: "write typescript code for a queue" },
    ]);
  });

  it("does not override a valid structured decision with route order", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["secondary code delegate answer"]],
      [
        createRoutingDecision({
          targetModel: "worker.code.secondary",
          matchedCapability: "code",
        }),
      ],
    );
    const service = new OrchestrationService(
      createDuplicateCodeCapabilityConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "write typescript code for a queue"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "secondary code delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.code.secondary"],
    );
  });

  it("uses orchestrator fallback only when selected by the structured decision", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["fallback streamed answer"]],
      [createFallbackRoutingDecision()],
    );
    const service = new OrchestrationService(
      createGeneralOnlyConfigService(),
      generation,
    );

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "write typescript code for a queue"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "fallback streamed answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["orchestrator.default"],
    );
    expect(generation.streamRequests[0]).toMatchObject({
      role: "orchestrator",
      messages: [
        { role: "user", content: "write typescript code for a queue" },
      ],
      abortSignal: expect.any(AbortSignal),
    });
    expect(generation.streamRequests[0].internalTools).toBeUndefined();
  });

  it("rejects orchestrator fallback when the route policy disables it", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [createFallbackRoutingDecision()],
    );
    const service = new OrchestrationService(
      createNoFallbackConfigService(),
      generation,
    );

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "write typescript code for a queue"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("executes independent pre-final agent tasks in parallel before final streaming", async () => {
    const generation = new ParallelPreFinalGenerationPort([
      {
        id: "context_a",
        targetModel: "worker.fast",
        task: "collect context A",
        dependencies: [],
      },
      {
        id: "context_b",
        targetModel: "worker.fast",
        task: "collect context B",
        dependencies: [],
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "explain HTTP caching"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "final streamed answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.maxConcurrentDelegates).toBe(2);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "worker.fast",
      "worker.fast",
    ]);
    expect(generation.streamRequests).toHaveLength(1);
    expect(generation.streamRequests[0]).toMatchObject({
      modelId: "worker.fast",
      role: "delegate",
      toolResults: [
        expect.objectContaining({
          targetModel: "worker.fast",
          task: "collect context A",
          status: "success",
          untrusted: true,
        }),
        expect.objectContaining({
          targetModel: "worker.fast",
          task: "collect context B",
          status: "success",
          untrusted: true,
        }),
      ],
    });
  });

  it("serializes dependent pre-final agent tasks before final streaming", async () => {
    const generation = new ParallelPreFinalGenerationPort([
      {
        id: "draft",
        targetModel: "worker.fast",
        task: "write draft",
        dependencies: [],
      },
      {
        id: "review",
        targetModel: "worker.fast",
        task: "review draft",
        dependencies: ["draft"],
      },
    ]);
    const service = new OrchestrationService(createConfigService(), generation);

    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "explain HTTP caching"),
      createRuntimeContext(),
    )) {
      void chunk;
    }

    expect(generation.maxConcurrentDelegates).toBe(1);
    expect(
      generation.requests
        .filter((request) => request.role === "delegate")
        .map((request) => request.messages[0]?.content),
    ).toEqual(["write draft", "review draft"]);
    const delegateRequests = generation.requests.filter(
      (request) => request.role === "delegate",
    );
    expect(delegateRequests[0].toolResults).toBeUndefined();
    expect(delegateRequests[1].toolResults).toEqual([
      expect.objectContaining({
        targetModel: "worker.fast",
        task: "write draft",
        status: "success",
        content: "result for write draft",
        untrusted: true,
      }),
    ]);
    expect(
      generation.streamRequests[0].toolResults?.map((result) => result.task),
    ).toEqual(["write draft", "review draft"]);
  });

  it("treats depends_on empty array as a final delegate call without pre-final context", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["final delegate answer"]],
      [
        {
          ...createRoutingDecision({
            targetModel: "worker.fast",
            matchedCapability: "general",
          }),
          pre_final_tasks: [],
        },
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "final delegate answer", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.streamRequests[0].toolResults).toBeUndefined();
  });

  it("rejects pre-final agent graphs with unresolved dependencies before provider calls", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        {
          ...createRoutingDecision({
            targetModel: "worker.fast",
            matchedCapability: "general",
          }),
          pre_final_tasks: [
            {
              task_id: "context",
              target_model: "worker.fast",
              matched_capability: "general",
              task: "collect context",
              depends_on: ["missing"],
            },
          ],
        },
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "explain HTTP caching"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("rejects pre-final agent graphs with cycles before provider calls", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        {
          ...createRoutingDecision({
            targetModel: "worker.fast",
            matchedCapability: "general",
          }),
          pre_final_tasks: [
            {
              task_id: "a",
              target_model: "worker.fast",
              matched_capability: "general",
              task: "first task",
              depends_on: ["b"],
            },
            {
              task_id: "b",
              target_model: "worker.fast",
              matched_capability: "general",
              task: "second task",
              depends_on: ["a"],
            },
          ],
        },
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "explain HTTP caching"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("counts pre-final agent tasks and forced delegate final targets against maxDelegations", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        {
          ...createRoutingDecision({
            targetModel: "worker.fast",
            matchedCapability: "general",
          }),
          pre_final_tasks: [
            {
              task_id: "context_a",
              target_model: "worker.fast",
              matched_capability: "general",
              task: "collect context A",
              depends_on: [],
            },
            {
              task_id: "context_b",
              target_model: "worker.fast",
              matched_capability: "general",
              task: "collect context B",
              depends_on: [],
            },
          ],
        },
      ],
    );
    const service = new OrchestrationService(
      createMaxDelegationsConfigService(2),
      generation,
    );

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "explain HTTP caching"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      param: "maxDelegations",
    });
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("propagates the final stream finish reason", async () => {
    const generation = new ScriptedGenerationPort(
      [
        {
          content: "planning answer should not be emitted",
          finishReason: "stop",
        },
      ],
      [
        {
          chunks: ["truncated ", "answer"],
          finishReason: "length",
        },
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    const chunks = [];
    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "truncated ", finishReason: null },
      { content: "answer", finishReason: null },
      { content: "", finishReason: "length" },
    ]);
  });

  it("enforces the route timeout while waiting for final stream chunks", async () => {
    const generation = new SlowFinalStreamGenerationPort();
    const service = new OrchestrationService(
      createShortTotalTimeoutConfigService(),
      generation,
    );

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 408,
      code: "timeout",
    });
    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.streamRequests[0].abortSignal?.aborted).toBe(true);
  });

  it("aborts the routing decision call when the route timeout elapses", async () => {
    const generation = new NeverResolvingRoutingDecisionGenerationPort();
    const service = new OrchestrationService(
      createShortTotalTimeoutConfigService(),
      generation,
    );

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 408,
      code: "timeout",
    });

    expect(generation.routingDecisionRequests).toHaveLength(1);
    expect(generation.routingDecisionRequests[0].abortSignal?.aborted).toBe(
      true,
    );
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("aborts the final delegate stream when the consumer closes the iterator", async () => {
    const generation = new CloseAwareFinalStreamGenerationPort();
    const service = new OrchestrationService(createConfigService(), generation);
    const stream = service.streamFinal(
      createRequest(routeModel, "hello"),
      createRuntimeContext(),
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { content: "first chunk", finishReason: null },
    });

    await iterator.return?.();

    expect(generation.streamRequests).toHaveLength(1);
    expect(generation.streamRequests[0].abortSignal?.aborted).toBe(true);
  });

  it("stops waiting for pending parallel pre-final tasks after a terminal failure", async () => {
    const generation = new FailingParallelPreFinalGenerationPort();
    const service = new OrchestrationService(createConfigService(), generation);
    const startedAt = Date.now();

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
    });

    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(generation.slowTaskAbortSignal?.aborted).toBe(true);
    expect(generation.slowTaskCompleted).toBe(false);
    expect(
      generation.requests.filter((request) => request.role === "delegate"),
    ).toHaveLength(2);
  });

  it("logs orchestration phases with requestId without prompts or responses", async () => {
    const generation = new ScriptedGenerationPort(
      [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "delegate_llm",
              arguments: {
                target_model: "worker.fast",
                task: "draft with prompt secret",
              },
            },
          ],
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        },
      ],
      [
        {
          chunks: ["delegate response must not be logged"],
          usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
        },
      ],
    );
    const logger = new CapturingOperationalLogger();
    const service = new OrchestrationService(
      createConfigService(),
      generation,
      logger,
    );

    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "full prompt must not be logged"),
      createRuntimeContext(),
    )) {
      void chunk;
      // Drain stream.
    }

    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "llm_invocation.completed",
          phase: "orchestrator_planning",
          requestId: "req-orchestration-test",
          routeId: "default",
          publicModel: routeModel,
          internalModel: "orchestrator.default",
          provider: "openrouter",
          status: "success",
        }),
        expect.objectContaining({
          event: "llm_invocation.completed",
          phase: "delegation",
          requestId: "req-orchestration-test",
          internalModel: "worker.fast",
          status: "success",
          usage: {
            prompt_tokens: 4,
            completion_tokens: 5,
            total_tokens: 9,
          },
        }),
      ]),
    );
    const serializedEvents = JSON.stringify(logger.events);
    expect(serializedEvents).not.toContain("full prompt must not be logged");
    expect(serializedEvents).not.toContain(
      "delegate response must not be logged",
    );
  });

  it("logs routing graph summary and parallel execution without internal content", async () => {
    const generation = new ParallelPreFinalGenerationPort([
      {
        id: "context_a",
        targetModel: "worker.fast",
        task: "collect context A",
        dependencies: [],
      },
      {
        id: "context_b",
        targetModel: "worker.fast",
        task: "collect context B",
        dependencies: [],
      },
    ]);
    const logger = new CapturingOperationalLogger();
    const service = new OrchestrationService(
      createConfigService(),
      generation,
      logger,
    );

    for await (const chunk of service.streamFinal(
      createRequest(routeModel, "explain HTTP caching with private context"),
      createRuntimeContext(),
    )) {
      void chunk;
    }

    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "routing.execution_graph.validated",
          requestId: "req-orchestration-test",
          routeId: "default",
          publicModel: routeModel,
          preFinalTaskCount: 2,
          dependencyCount: 0,
          delegationAttemptCount: 3,
          finalTargetType: "delegate",
          finalTargetModel: "worker.fast",
        }),
        expect.objectContaining({
          event: "routing.execution_graph.executed",
          requestId: "req-orchestration-test",
          routeId: "default",
          publicModel: routeModel,
          preFinalTaskCount: 2,
          parallelBatchCount: 1,
          maxParallelTasks: 2,
        }),
      ]),
    );
    const serializedEvents = JSON.stringify(logger.events);
    expect(serializedEvents).not.toContain("explain HTTP caching");
    expect(serializedEvents).not.toContain("collect context A");
    expect(serializedEvents).not.toContain("collect context B");
    expect(serializedEvents).not.toContain("result for");
  });

  it("rejects structured routing decisions targeting a model outside the active route", async () => {
    const generation = new ScriptedGenerationPort(
      [],
      [["should not stream"]],
      [
        createRoutingDecision({
          targetModel: "worker.restricted",
          matchedCapability: "reasoning",
        }),
      ],
    );
    const service = new OrchestrationService(createConfigService(), generation);

    await expect(async () => {
      for await (const chunk of service.streamFinal(
        createRequest(routeModel, "hello"),
        createRuntimeContext(),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
      message: "Routing decision failed validation.",
    });
    expect(generation.requests).toHaveLength(0);
    expect(generation.streamRequests).toHaveLength(0);
  });
});

function createRequest(model: string, content: string): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: "user", content }],
  };
}

function createDefaultRoutingDecision(
  request: LlmRoutingDecisionRequest,
): RoutingDecision {
  const delegate = request.delegateModels[0];
  if (!delegate) {
    return {
      final_target: {
        type: "orchestrator_fallback",
        reason: "No allowed delegate was provided in the test catalog.",
      },
      pre_final_tasks: [],
    };
  }

  return createRoutingDecision({
    targetModel: delegate.id,
    matchedCapability: delegate.capabilities[0] ?? "general",
  });
}

function createRoutingDecision(input: {
  targetModel: string;
  matchedCapability: string;
}): RoutingDecision {
  return {
    final_target: {
      type: "delegate",
      target_model: input.targetModel,
      matched_capability: input.matchedCapability,
      reason: "Selected by the structured routing decision.",
    },
    pre_final_tasks: [],
  };
}

function createFallbackRoutingDecision(): RoutingDecision {
  return {
    final_target: {
      type: "orchestrator_fallback",
      reason: "No allowed delegate is suitable.",
    },
    pre_final_tasks: [],
  };
}

function createRuntimeContext() {
  return {
    requestId: "req-orchestration-test",
    routeId: "default",
    publicModel: routeModel,
    stream: false,
  };
}

function createConfigService(): GatewayConfigService {
  return new GatewayConfigService({
    rawConfig: minimalConfig(),
    env: validEnv(),
  });
}

function createCodingConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.models["worker.fast"].capabilities = ["code", "general"];
  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createCanonicalCapabilityConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.models = {
    ...config.models,
    "worker.code": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["code"],
    },
    "worker.review": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["review"],
    },
    "worker.design": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["design"],
    },
    "worker.plan": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["plan"],
    },
    "worker.general": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["general"],
    },
  };
  config.routes.default.allowedDelegateModels = [
    "worker.code",
    "worker.review",
    "worker.design",
    "worker.plan",
    "worker.general",
  ];

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createDuplicateCodeCapabilityConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.models = {
    ...config.models,
    "worker.code.primary": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["code"],
    },
    "worker.code.secondary": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["code"],
    },
    "worker.general": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["general"],
    },
  };
  config.routes.default.allowedDelegateModels = [
    "worker.code.primary",
    "worker.code.secondary",
    "worker.general",
  ];

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createMathCapabilityConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.models = {
    ...config.models,
    "worker.math": {
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["math"],
    },
  };
  config.routes.default.allowedDelegateModels = ["worker.math"];

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createGeneralOnlyConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.models["worker.fast"].capabilities = ["general"];

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createNoFallbackConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.routes.default.allowOrchestratorFallback = false;

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createMaxDelegationsConfigService(
  maxDelegations: number,
): GatewayConfigService {
  const config = minimalConfig();
  config.routes.default.maxDelegations = maxDelegations;

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function createShortTotalTimeoutConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.routes.default.timeoutMs = 10;
  config.routes.default.delegateTimeoutMs = 10;

  return new GatewayConfigService({
    rawConfig: config,
    env: validEnv(),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class FastTimeoutConfigService extends GatewayConfigService {
  constructor() {
    super({
      rawConfig: minimalConfig(),
      env: validEnv(),
    });
  }

  override resolveRouteByPublicModel(publicModel: string) {
    const route = super.resolveRouteByPublicModel(publicModel);
    if (!route) {
      return undefined;
    }

    return {
      ...route,
      timeoutMs: 1000,
      delegateTimeoutMs: 1,
    };
  }
}
