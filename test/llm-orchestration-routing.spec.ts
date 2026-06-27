import { OpenAiHttpError } from "../src/errors/openai-http-error";
import { GatewayConfigService } from "../src/config/gateway-config.service";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
  LlmStreamChunk,
} from "../src/orchestration/llm-generation.port";
import { OrchestrationService } from "../src/orchestration/orchestration.service";
import { ChatCompletionRequest } from "../src/v1/openai-types";
import { minimalConfig, validEnv } from "./support/gateway-config.fixture";

const routeModel = "route/default";

class ScriptedGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  readonly streamRequests: LlmGenerateRequest[] = [];
  private readonly results: Array<
    LlmGenerateResult | Promise<LlmGenerateResult>
  >;
  private readonly streamResults: ScriptedStreamResult[];

  constructor(
    results: Array<LlmGenerateResult | Promise<LlmGenerateResult>>,
    streamResults: Array<string[] | ScriptedStreamResult> = [],
  ) {
    this.results = [...results];
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
  readonly streamRequests: LlmGenerateRequest[] = [];
  maxConcurrentDelegates = 0;
  private currentDelegates = 0;

  constructor(private readonly tasks: PreFinalTaskFixture[]) {}

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

  it("streams the selected delegate directly after router planning", async () => {
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
                task: "draft a streamable answer",
                output_contract: "Answer directly to the client.",
              },
            },
          ],
        },
      ],
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
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.requests[0].internalTools).toEqual(["delegate_llm"]);
    expect(generation.streamRequests[0]).toMatchObject({
      role: "delegate",
      messages: [{ role: "user", content: "draft a streamable answer" }],
      system: "Answer directly to the client.",
    });
    expect(generation.streamRequests[0].internalTools).toBeUndefined();
    expect(generation.streamRequests[0].toolResults).toBeUndefined();
  });

  it("uses a general delegate final stream when the orchestrator answers directly", async () => {
    const generation = new ScriptedGenerationPort(
      [
        {
          content: "planning answer should not be emitted",
          finishReason: "stop",
        },
      ],
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
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.fast"],
    );
    expect(generation.streamRequests[0].internalTools).toBeUndefined();
  });

  it("routes coding streaming requests to a coding-capable delegate when the orchestrator answers directly", async () => {
    const generation = new ScriptedGenerationPort(
      [
        {
          content: "orchestrator direct code should not be streamed",
          finishReason: "stop",
        },
      ],
      [["print('hello world')"]],
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
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
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
      system: expect.stringContaining("code"),
    });
  });

  it.each([
    ["code", "implemente uma função typescript para somar números"],
    ["review", "revise este patch e encontre riscos de regressão"],
    ["design", "desenhe o fluxo de uma tela de checkout mobile"],
    ["plan", "crie um plano de implementação para autenticação"],
    ["general", "explique a diferença entre HTTP e HTTPS"],
  ])(
    "routes %s streaming requests to a matching canonical delegate when the orchestrator answers directly",
    async (capability, prompt) => {
      const generation = new ScriptedGenerationPort(
        [
          {
            content: "orchestrator planning text must not be streamed",
            finishReason: "stop",
          },
        ],
        [[`${capability} delegate answer`]],
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
      expect(generation.requests.map((request) => request.modelId)).toEqual([
        "orchestrator.default",
      ]);
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

  it("corrects a streaming final target when the orchestrator chooses a delegate without the classified capability", async () => {
    const generation = new ScriptedGenerationPort(
      [
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_wrong",
              name: "delegate_llm",
              arguments: {
                target_model: "worker.general",
                task: "answer as a generalist",
              },
            },
          ],
        },
      ],
      [["code delegate answer"]],
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
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["worker.code"],
    );
    expect(generation.streamRequests[0].messages).toEqual([
      { role: "user", content: "write typescript code for a queue" },
    ]);
  });

  it("uses orchestrator fallback for specialized streaming requests when no exact delegate exists", async () => {
    const generation = new ScriptedGenerationPort(
      [
        {
          content: "planning text must not be streamed",
          finishReason: "stop",
        },
      ],
      [["fallback streamed answer"]],
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
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
    expect(generation.streamRequests.map((request) => request.modelId)).toEqual(
      ["orchestrator.default"],
    );
    expect(generation.streamRequests[0]).toMatchObject({
      role: "orchestrator",
      messages: [
        { role: "user", content: "write typescript code for a queue" },
      ],
    });
    expect(generation.streamRequests[0].internalTools).toBeUndefined();
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
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
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
    expect(
      generation.streamRequests[0].toolResults?.map((result) => result.task),
    ).toEqual(["write draft", "review draft"]);
  });

  it("rejects pre-final agent graphs with unresolved dependencies before provider calls", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_a",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "collect context",
              task_id: "context",
              depends_on: ["missing"],
              final: false,
            },
          },
        ],
      },
    ]);
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
    });
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("rejects pre-final agent graphs with cycles before provider calls", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_a",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "first task",
              task_id: "a",
              depends_on: ["b"],
              final: false,
            },
          },
          {
            id: "call_b",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "second task",
              task_id: "b",
              depends_on: ["a"],
              final: false,
            },
          },
        ],
      },
    ]);
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
    });
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
    expect(generation.streamRequests).toHaveLength(0);
  });

  it("counts pre-final agent tasks and forced delegate final targets against maxDelegations", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_a",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "collect context A",
              task_id: "context_a",
              final: false,
            },
          },
          {
            id: "call_b",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "collect context B",
              task_id: "context_b",
              final: false,
            },
          },
        ],
      },
    ]);
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
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
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

  it("logs routing classification, graph summary, and parallel execution without internal content", async () => {
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
          event: "routing.classified",
          requestId: "req-orchestration-test",
          routeId: "default",
          publicModel: routeModel,
          classifiedCapability: "general",
          classificationMethod: "default_general",
          finalTargetType: "delegate",
          finalTargetModel: "worker.fast",
        }),
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

  it("rejects multiple streaming delegate targets before opening the delegate stream", async () => {
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
          ],
        },
      ],
      [["should not stream"]],
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
    });
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
    ]);
    expect(generation.streamRequests).toHaveLength(0);
  });
});

function createRequest(model: string, content: string): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: "user", content }],
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

function createGeneralOnlyConfigService(): GatewayConfigService {
  const config = minimalConfig();
  config.models["worker.fast"].capabilities = ["general"];

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
