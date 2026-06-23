import { OpenAiHttpError } from "../src/errors/openai-http-error";
import { GatewayConfigService } from "../src/config/gateway-config.service";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
} from "../src/orchestration/llm-generation.port";
import { OrchestrationService } from "../src/orchestration/orchestration.service";
import { ChatCompletionRequest } from "../src/v1/openai-types";

class ScriptedGenerationPort implements LlmGenerationPort {
  readonly requests: LlmGenerateRequest[] = [];
  private readonly results: Array<
    LlmGenerateResult | Promise<LlmGenerateResult>
  >;

  constructor(results: Array<LlmGenerateResult | Promise<LlmGenerateResult>>) {
    this.results = [...results];
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) {
      throw new Error("Unexpected generation request.");
    }
    return next;
  }
}

describe("LLM orchestration routing", () => {
  const routeModel = "route/default";

  it("calls the configured orchestrator for a direct response", async () => {
    const generation = new ScriptedGenerationPort([
      {
        content: "direct answer",
        finishReason: "stop",
      },
    ]);
    const service = new OrchestrationService(
      new GatewayConfigService(),
      generation,
    );

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response.content).toBe("direct answer");
    expect(response.finishReason).toBe("stop");
    expect(generation.requests).toHaveLength(1);
    expect(generation.requests[0]).toMatchObject({
      modelId: "orchestrator.default",
      role: "orchestrator",
      timeoutMs: 60000,
    });
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
    const service = new OrchestrationService(
      new GatewayConfigService(),
      generation,
    );

    const response = await service.run(createRequest(routeModel, "hello"));

    expect(response.content).toBe("final synthesis");
    expect(generation.requests.map((request) => request.modelId)).toEqual([
      "orchestrator.default",
      "worker.fast",
      "orchestrator.default",
    ]);
    expect(generation.requests[1]).toMatchObject({
      role: "delegate",
      timeoutMs: 30000,
    });
    expect(generation.requests[2].toolResults).toEqual([
      expect.objectContaining({
        targetModel: "worker.fast",
        status: "success",
        content: "delegate draft",
        untrusted: true,
      }),
    ]);
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
    const service = new OrchestrationService(
      new GatewayConfigService(),
      generation,
    );

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
    const service = new OrchestrationService(
      new GatewayConfigService(),
      generation,
    );

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
  });
});

function createRequest(model: string, content: string): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: "user", content }],
  };
}

class FastTimeoutConfigService extends GatewayConfigService {
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
