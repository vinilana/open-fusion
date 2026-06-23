import {
  OpenRouterAdapter,
  OpenRouterSdk,
} from "../src/providers/openrouter.adapter";
import { ProviderBackedLlmGenerationPort } from "../src/providers/provider-backed-llm-generation.port";
import { ProviderRegistry } from "../src/providers/provider-registry";
import { LlmGenerateRequest } from "../src/orchestration/llm-generation.port";
import { GatewayConfigService } from "../src/config/gateway-config.service";
import { minimalConfig, validEnv } from "./support/gateway-config.fixture";

describe("OpenRouter provider adapter", () => {
  it("calls OpenRouter through the AI SDK using resolved config and provider model ids", async () => {
    const sdk = createFakeSdk({
      text: "provider answer",
      finishReason: "stop",
      totalUsage: usage(4, 6, 10),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    const result = await adapter.generate(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      createGenerateRequest("worker.fast"),
    );

    expect(result).toEqual({
      content: "provider answer",
      finishReason: "stop",
      usage: {
        promptTokens: 4,
        completionTokens: 6,
        totalTokens: 10,
      },
    });
    expect(sdk.createOpenRouterCalls[0]).toMatchObject({
      apiKey: "sk-openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://example.com",
        "X-Title": "Open Fusion",
      },
    });
    expect(sdk.chatModelIds).toEqual(["openai/gpt-4.1-mini"]);
    expect(sdk.generateTextCalls[0]).toMatchObject({
      model: { providerModelId: "openai/gpt-4.1-mini" },
      messages: [{ role: "user", content: "hello" }],
      timeout: 30000,
      temperature: 0.3,
      providerOptions: {
        openrouter: {},
      },
    });
  });

  it("maps delegate_llm tool calls from AI SDK results", async () => {
    const sdk = createFakeSdk({
      text: "",
      finishReason: "tool-calls",
      toolCalls: [
        {
          toolCallId: "call_1",
          toolName: "delegate_llm",
          input: {
            target_model: "worker.fast",
            task: "draft",
            reason: "fast",
          },
        },
      ],
      totalUsage: usage(1, 1, 2),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    const result = await adapter.generate(
      config.getProvider("openrouter")!,
      config.findInternalModel("orchestrator.default")!,
      createGenerateRequest("orchestrator.default"),
    );

    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "delegate_llm",
        arguments: {
          target_model: "worker.fast",
          task: "draft",
          reason: "fast",
        },
      },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("streams text chunks through the OpenRouter AI SDK path", async () => {
    const sdk = createFakeSdk({
      text: "unused",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
      streamChunks: ["hello", " ", "world"],
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      createGenerateRequest("worker.fast"),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hello", " ", "world"]);
    expect(sdk.streamTextCalls[0]).toMatchObject({
      model: { providerModelId: "openai/gpt-4.1-mini" },
      timeout: 30000,
    });
  });

  it("normalizes provider failures without leaking credentials", async () => {
    const sdk = createFakeSdk(
      new Error("OpenRouter failed for apiKey sk-openrouter"),
    );
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    await expect(
      adapter.generate(
        config.getProvider("openrouter")!,
        config.findInternalModel("worker.fast")!,
        createGenerateRequest("worker.fast"),
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
    });

    await expect(
      adapter.generate(
        config.getProvider("openrouter")!,
        config.findInternalModel("worker.fast")!,
        createGenerateRequest("worker.fast"),
      ),
    ).rejects.not.toThrow("sk-openrouter");
  });

  it("resolves configured model provider through the provider-backed generation port", async () => {
    const sdk = createFakeSdk({
      text: "registry answer",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
    });
    const config = createConfig();
    const port = new ProviderBackedLlmGenerationPort(
      config,
      new ProviderRegistry(config, new OpenRouterAdapter(sdk)),
    );

    const result = await port.generate(createGenerateRequest("worker.fast"));

    expect(result.content).toBe("registry answer");
    expect(sdk.chatModelIds).toEqual(["openai/gpt-4.1-mini"]);
  });
});

function createConfig(): GatewayConfigService {
  return new GatewayConfigService({
    rawConfig: minimalConfig(),
    env: validEnv(),
  });
}

function createGenerateRequest(modelId: string): LlmGenerateRequest {
  return {
    modelId,
    publicModelId: "route/default",
    role: modelId.startsWith("orchestrator") ? "orchestrator" : "delegate",
    messages: [{ role: "user", content: "hello" }],
    timeoutMs: 30000,
  };
}

function createFakeSdk(
  result: FakeGenerateTextResult | Error,
): OpenRouterSdk & {
  createOpenRouterCalls: unknown[];
  chatModelIds: string[];
  generateTextCalls: unknown[];
  streamTextCalls: unknown[];
} {
  const createOpenRouterCalls: unknown[] = [];
  const chatModelIds: string[] = [];
  const generateTextCalls: unknown[] = [];
  const streamTextCalls: unknown[] = [];

  return {
    createOpenRouterCalls,
    chatModelIds,
    generateTextCalls,
    streamTextCalls,
    createOpenRouter(options) {
      createOpenRouterCalls.push(options);
      return {
        chat(modelId: string) {
          chatModelIds.push(modelId);
          return { providerModelId: modelId };
        },
      };
    },
    async generateText(options) {
      generateTextCalls.push(options);
      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
    streamText(options) {
      streamTextCalls.push(options);
      if (result instanceof Error) {
        throw result;
      }

      return {
        textStream: toAsyncIterable(result.streamChunks ?? []),
      };
    },
  };
}

interface FakeGenerateTextResult {
  text: string;
  finishReason: string;
  totalUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }>;
  streamChunks?: string[];
}

function usage(input: number, output: number, total: number) {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
  };
}

async function* toAsyncIterable(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
