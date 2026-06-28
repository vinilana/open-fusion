import {
  OpenRouterAdapter,
  OpenRouterSdk,
} from "../src/providers/openrouter.adapter";
import { ProviderBackedLlmGenerationPort } from "../src/providers/provider-backed-llm-generation.port";
import { ProviderRegistry } from "../src/providers/provider-registry";
import {
  LlmGenerateRequest,
  LlmStreamChunk,
} from "../src/orchestration/llm-generation.port";
import { GatewayConfigService } from "../src/config/gateway-config.service";
import { OpenAiHttpError } from "../src/errors/openai-http-error";
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

  it("passes abort signals through to OpenRouter generate calls", async () => {
    const sdk = createFakeSdk({
      text: "provider answer",
      finishReason: "stop",
      totalUsage: usage(4, 6, 10),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();
    const abortController = new AbortController();

    await adapter.generate(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      {
        ...createGenerateRequest("worker.fast"),
        abortSignal: abortController.signal,
      },
    );

    expect(sdk.generateTextCalls[0]).toMatchObject({
      abortSignal: abortController.signal,
    });
  });

  it("moves client system messages into the AI SDK system option", async () => {
    const sdk = createFakeSdk({
      text: "provider answer",
      finishReason: "stop",
      totalUsage: usage(4, 6, 10),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    await adapter.generate(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      {
        ...createGenerateRequest("worker.fast"),
        system: "gateway system",
        messages: [
          { role: "system", content: "client system" },
          { role: "user", content: "hello" },
        ],
      },
    );

    expect(sdk.generateTextCalls[0]).toMatchObject({
      system: expect.stringContaining("gateway system"),
      messages: [{ role: "user", content: "hello" }],
    });
    expect(sdk.generateTextCalls[0]).toMatchObject({
      system: expect.stringContaining("client system"),
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

  it("preserves valid provider-supplied delegate messages", async () => {
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
            messages: [
              { role: "system", content: "client context" },
              { role: "user", content: "write the draft" },
              { role: "assistant", content: null, name: "assistant_alias" },
              { role: "tool", content: "tool result", tool_call_id: "tool_1" },
            ],
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

    expect(result.toolCalls?.[0].arguments.messages).toEqual([
      { role: "system", content: "client context" },
      { role: "user", content: "write the draft" },
      { role: "assistant", content: null, name: "assistant_alias" },
      { role: "tool", content: "tool result", tool_call_id: "tool_1" },
    ]);
  });

  it("omits malformed provider-supplied delegate messages", async () => {
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
            messages: [
              { role: "user", content: "valid first message" },
              { role: "developer", content: "unsupported role" },
            ],
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
        },
      },
    ]);
  });

  it("registers the internal delegate_llm tool with the AI SDK when requested", async () => {
    const sdk = createFakeSdk({
      text: "unused",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    await adapter.generate(
      config.getProvider("openrouter")!,
      config.findInternalModel("orchestrator.default")!,
      {
        ...createGenerateRequest("orchestrator.default"),
        internalTools: ["delegate_llm"],
      },
    );

    const generateOptions = sdk.generateTextCalls[0] as {
      tools?: {
        delegate_llm?: {
          description?: string;
          inputSchema?: { jsonSchema: unknown };
        };
      };
    };
    expect(generateOptions.tools).toHaveProperty("delegate_llm");
    expect(generateOptions.tools?.delegate_llm?.description).toContain(
      "Delegate",
    );
    await expect(
      Promise.resolve(
        generateOptions.tools?.delegate_llm?.inputSchema?.jsonSchema,
      ),
    ).resolves.toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["target_model", "task"],
      properties: {
        target_model: { type: "string" },
        task: { type: "string" },
        messages: { type: "array" },
        output_contract: { type: "string" },
        reason: { type: "string" },
      },
    });
  });

  it("does not register internal tools for final synthesis generate or stream requests", async () => {
    const sdk = createFakeSdk({
      text: "final answer",
      finishReason: "stop",
      totalUsage: usage(8, 13, 21),
      streamChunks: ["final", " answer"],
      streamFinishReason: "stop",
      streamUsage: usage(8, 13, 21),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();
    const finalSynthesisRequest: LlmGenerateRequest = {
      ...createGenerateRequest("orchestrator.default"),
      toolResults: [
        {
          toolCallId: "call_1",
          targetModel: "worker.fast",
          task: "draft",
          status: "success",
          content: "delegate result",
          finishReason: "stop",
          usage: {
            promptTokens: 2,
            completionTokens: 3,
            totalTokens: 5,
          },
          latencyMs: 42,
          untrusted: true,
        },
      ],
    };

    await adapter.generate(
      config.getProvider("openrouter")!,
      config.findInternalModel("orchestrator.default")!,
      finalSynthesisRequest,
    );

    const streamChunks: LlmStreamChunk[] = [];
    for await (const chunk of adapter.stream(
      config.getProvider("openrouter")!,
      config.findInternalModel("orchestrator.default")!,
      finalSynthesisRequest,
    )) {
      streamChunks.push(chunk);
    }

    expect(streamChunks).toEqual([
      { content: "final", finishReason: null },
      { content: " answer", finishReason: null },
      {
        content: "",
        finishReason: "stop",
        usage: { promptTokens: 8, completionTokens: 13, totalTokens: 21 },
      },
    ]);
    expect(sdk.generateTextCalls[0]).not.toHaveProperty("tools");
    expect(sdk.streamTextCalls[0]).not.toHaveProperty("tools");
  });

  it("streams text chunks through the OpenRouter AI SDK path", async () => {
    const sdk = createFakeSdk({
      text: "unused",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
      streamChunks: ["hello", " ", "world"],
      streamFinishReason: "length",
      streamUsage: usage(3, 5, 8),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of adapter.stream(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      createGenerateRequest("worker.fast"),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "hello", finishReason: null },
      { content: " ", finishReason: null },
      { content: "world", finishReason: null },
      {
        content: "",
        finishReason: "length",
        usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      },
    ]);
    expect(sdk.streamTextCalls[0]).toMatchObject({
      model: { providerModelId: "openai/gpt-4.1-mini" },
      timeout: 30000,
    });
  });

  it("passes abort signals through to OpenRouter stream calls", async () => {
    const sdk = createFakeSdk({
      text: "unused",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
      streamChunks: ["hello"],
      streamFinishReason: "stop",
      streamUsage: usage(1, 1, 2),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();
    const abortController = new AbortController();

    for await (const chunk of adapter.stream(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      {
        ...createGenerateRequest("worker.fast"),
        abortSignal: abortController.signal,
      },
    )) {
      void chunk;
    }

    expect(sdk.streamTextCalls[0]).toMatchObject({
      abortSignal: abortController.signal,
    });
  });

  it("moves client system messages into the AI SDK system option for streams", async () => {
    const sdk = createFakeSdk({
      text: "unused",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
      streamChunks: ["hello"],
      streamFinishReason: "content-filter",
      streamUsage: usage(2, 4, 6),
    });
    const adapter = new OpenRouterAdapter(sdk);
    const config = createConfig();

    for await (const chunk of adapter.stream(
      config.getProvider("openrouter")!,
      config.findInternalModel("worker.fast")!,
      {
        ...createGenerateRequest("worker.fast"),
        system: "gateway system",
        messages: [
          { role: "system", content: "client system" },
          { role: "user", content: "hello" },
        ],
      },
    )) {
      if (chunk.finishReason === null) {
        expect(chunk.content).toBe("hello");
      }
    }

    expect(sdk.streamTextCalls[0]).toMatchObject({
      system: expect.stringContaining("gateway system"),
      messages: [{ role: "user", content: "hello" }],
    });
    expect(sdk.streamTextCalls[0]).toMatchObject({
      system: expect.stringContaining("client system"),
    });
  });

  it("normalizes provider failures without leaking raw provider details", async () => {
    const sdk = createFakeSdk(
      new Error(
        [
          "OpenRouter failed for apiKey sk-openrouter",
          "Authorization: Bearer provider-token",
          "prompt: full private prompt",
          "at provider stack trace",
        ].join("\n"),
      ),
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
    ).rejects.toThrow("The provider failed to complete the request.");

    await expect(
      adapter.generate(
        config.getProvider("openrouter")!,
        config.findInternalModel("worker.fast")!,
        createGenerateRequest("worker.fast"),
      ),
    ).rejects.not.toThrow("sk-openrouter");

    await expect(
      adapter.generate(
        config.getProvider("openrouter")!,
        config.findInternalModel("worker.fast")!,
        createGenerateRequest("worker.fast"),
      ),
    ).rejects.not.toThrow("full private prompt");

    await expect(async () => {
      for await (const chunk of adapter.stream(
        config.getProvider("openrouter")!,
        config.findInternalModel("worker.fast")!,
        createGenerateRequest("worker.fast"),
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({
      status: 502,
      code: "provider_error",
    });
    await expect(async () => {
      for await (const chunk of adapter.stream(
        config.getProvider("openrouter")!,
        config.findInternalModel("worker.fast")!,
        createGenerateRequest("worker.fast"),
      )) {
        void chunk;
      }
    }).rejects.toThrow("The provider failed to complete the request.");
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

  it("maps unresolved internal models to internal errors before generate provider calls", async () => {
    const sdk = createFakeSdk({
      text: "should not be called",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
    });
    const config = createConfig();
    const port = new ProviderBackedLlmGenerationPort(
      config,
      new ProviderRegistry(config, new OpenRouterAdapter(sdk)),
    );

    await expectInternalModelError(
      () => port.generate(createGenerateRequest("missing.internal")),
      "missing.internal",
    );
    expect(sdk.generateTextCalls).toHaveLength(0);
  });

  it("maps unresolved internal models to internal errors before stream provider calls", async () => {
    const sdk = createFakeSdk({
      text: "should not be called",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
      streamChunks: ["should not stream"],
    });
    const config = createConfig();
    const port = new ProviderBackedLlmGenerationPort(
      config,
      new ProviderRegistry(config, new OpenRouterAdapter(sdk)),
    );

    await expectInternalModelError(async () => {
      for await (const chunk of port.stream(
        createGenerateRequest("missing.internal"),
      )) {
        void chunk;
      }
    }, "missing.internal");
    expect(sdk.streamTextCalls).toHaveLength(0);
  });

  it("preserves stream finish reason and usage through the provider-backed generation port", async () => {
    const sdk = createFakeSdk({
      text: "unused",
      finishReason: "stop",
      totalUsage: usage(0, 0, 0),
      streamChunks: ["partial"],
      streamFinishReason: "content-filter",
      streamUsage: usage(11, 13, 24),
    });
    const config = createConfig();
    const port = new ProviderBackedLlmGenerationPort(
      config,
      new ProviderRegistry(config, new OpenRouterAdapter(sdk)),
    );

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of port.stream(
      createGenerateRequest("worker.fast"),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "partial", finishReason: null },
      {
        content: "",
        finishReason: "content_filter",
        usage: { promptTokens: 11, completionTokens: 13, totalTokens: 24 },
      },
    ]);
  });
});

function createConfig(): GatewayConfigService {
  return new GatewayConfigService({
    rawConfig: minimalConfig(),
    env: validEnv(),
  });
}

async function expectInternalModelError(
  action: () => Promise<unknown>,
  internalModelId: string,
): Promise<void> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(OpenAiHttpError);

  const error = caught as OpenAiHttpError;
  expect(error).toMatchObject({
    status: 500,
    type: "server_error",
    code: "internal_error",
  });

  const body = error.toBody();
  expect(body).toEqual({
    error: {
      message: "Configured internal model was not found.",
      type: "server_error",
      param: null,
      code: "internal_error",
    },
  });
  expect(JSON.stringify(body)).not.toContain(internalModelId);
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
        finishReason: Promise.resolve(result.streamFinishReason ?? "stop"),
        totalUsage: Promise.resolve(result.streamUsage ?? result.totalUsage),
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
  streamFinishReason?: string;
  streamUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
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
