import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { configureHttpApp } from "../src/http-app";
import { OpenAiHttpError } from "../src/errors/openai-http-error";
import { RawGatewayConfig } from "../src/config/gateway-config.service";
import {
  LLM_GENERATION_PORT,
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
  LlmRoutingDecisionRequest,
  LlmStreamChunk,
  RoutingDecision,
} from "../src/orchestration/llm-generation.port";
import { StubLlmGenerationPort } from "../src/orchestration/stub-llm-generation.port";
import {
  minimalConfig,
  validEnv,
  writeConfig,
} from "./support/gateway-config.fixture";

describe("OpenAI-compatible API", () => {
  let app: INestApplication;
  let cleanupConfig: (() => void) | undefined;
  let previousEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    previousEnv = { ...process.env };
    const config = writeConfig();
    cleanupConfig = config.cleanup;
    process.env.OPEN_FUSION_CONFIG = config.path;
    Object.assign(process.env, validEnv());

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_GENERATION_PORT)
      .useClass(StubLlmGenerationPort)
      .compile();

    app = moduleRef.createNestApplication({
      bodyParser: false,
    });
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    cleanupConfig?.();
    restoreProcessEnv(previousEnv);
  });

  it("rejects unauthenticated /v1 requests with an OpenAI-compatible error", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .expect(401);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body).toEqual({
      error: {
        message: "Missing or invalid bearer token.",
        type: "authentication_error",
        param: null,
        code: "invalid_api_key",
      },
    });
  });

  it("serves public health checks without authentication", async () => {
    await request(app.getHttpServer()).get("/health/live").expect(200, {
      status: "ok",
    });
    await request(app.getHttpServer())
      .get("/health/ready")
      .expect(200, {
        status: "ok",
        checks: {
          config: "loaded",
        },
      });
  });

  it("logs auth failures for /v1 requests without bearer tokens", async () => {
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      await request(app.getHttpServer())
        .get("/v1/models")
        .set("x-request-id", "req-auth-log")
        .expect(401);

      const serializedLogs = logSpy.mock.calls.flat().join("\n");
      expect(serializedLogs).toContain('"event":"http_request.failed"');
      expect(serializedLogs).toContain('"requestId":"req-auth-log"');
      expect(serializedLogs).toContain('"method":"GET"');
      expect(serializedLogs).toContain('"path":"/v1/models"');
      expect(serializedLogs).toContain('"statusCode":401');
      expect(serializedLogs).not.toContain("Authorization");
      expect(serializedLogs).not.toContain("Bearer");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rejects invalid bearer tokens without echoing the token", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("Authorization", "Bearer invalid-secret-token")
      .expect(401);

    expect(JSON.stringify(response.body)).not.toContain("invalid-secret-token");
    expect(response.body.error.code).toBe("invalid_api_key");
  });

  it("logs successful /v1/models requests without prompts, responses, or tokens", async () => {
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      await request(app.getHttpServer())
        .get("/v1/models")
        .set("Authorization", "Bearer test-gateway-key")
        .set("x-request-id", "req-models-log")
        .expect(200);

      const serializedLogs = logSpy.mock.calls.flat().join("\n");
      expect(serializedLogs).toContain('"event":"http_request.completed"');
      expect(serializedLogs).toContain('"requestId":"req-models-log"');
      expect(serializedLogs).toContain('"clientId":"local-dev"');
      expect(serializedLogs).toContain('"method":"GET"');
      expect(serializedLogs).toContain('"path":"/v1/models"');
      expect(serializedLogs).toContain('"statusCode":200');
      expect(serializedLogs).not.toContain("test-gateway-key");
      expect(serializedLogs).not.toContain("route/default");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("lists public models for an authenticated client", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("Authorization", "Bearer test-gateway-key")
      .set("x-request-id", "req-contract-001")
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["x-request-id"]).toBe("req-contract-001");
    expect(response.body).toEqual({
      object: "list",
      data: [
        {
          id: "route/default",
          object: "model",
          created: expect.any(Number),
          owned_by: "open-fusion",
        },
      ],
    });
  });

  it("replaces unsafe request ids with a generated response id", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("Authorization", "Bearer test-gateway-key")
      .set("x-request-id", "unsafe id with spaces")
      .expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).not.toBe("unsafe id with spaces");
  });

  it("returns validation errors using the OpenAI error envelope", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({ model: "route/default", messages: "invalid" })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        message: "messages must be a non-empty array.",
        type: "invalid_request_error",
        param: "messages",
        code: "invalid_request",
      },
    });
  });

  it("returns an OpenAI-compatible error when the JSON body exceeds the configured parser limit", async () => {
    const rawConfig = minimalConfig();
    rawConfig.routes.default.maxPayloadBytes = 80;
    const limitedApp = await createAppWithGenerationPort(
      StubLlmGenerationPort,
      rawConfig,
    );

    try {
      const response = await request(limitedApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set(
          "Authorization",
          ["Bearer", validEnv().OPEN_FUSION_DEV_API_KEY].join(" "),
        )
        .set("x-request-id", "req-payload-limit")
        .send({
          model: "route/default",
          messages: [{ role: "user", content: "payload too large" }],
        })
        .expect(429);

      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["x-request-id"]).toBe("req-payload-limit");
      expect(response.body).toEqual({
        error: {
          message: "Request payload exceeds the configured limit of 80 bytes.",
          type: "rate_limit_error",
          param: null,
          code: "rate_limit_exceeded",
        },
      });
    } finally {
      await limitedApp.close();
    }
  });

  it("logs validation failures that happen before route context is available", async () => {
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      await request(app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .set("x-request-id", "req-validation-log")
        .send({
          model: "route/default",
          stream: true,
          messages: "invalid",
        })
        .expect(400);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"chat_completion.failed"'),
      );
      const serializedLogs = logSpy.mock.calls.flat().join("\n");
      expect(serializedLogs).toContain('"requestId":"req-validation-log"');
      expect(serializedLogs).toContain('"clientId":"local-dev"');
      expect(serializedLogs).toContain('"publicModel":"route/default"');
      expect(serializedLogs).toContain('"stream":true');
      expect(serializedLogs).toContain('"status":"error"');
      expect(serializedLogs).toContain('"type":"invalid_request_error"');
      expect(serializedLogs).toContain('"code":"invalid_request"');
      expect(serializedLogs).toContain('"param":"messages"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns 403 when the client cannot access the requested model", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer restricted-gateway-key")
      .send({
        model: "route/default",
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(403);

    expect(response.body).toEqual({
      error: {
        message: "Client is not allowed to access model 'route/default'.",
        type: "invalid_request_error",
        param: "model",
        code: "model_not_allowed",
      },
    });
  });

  it("returns 404 for an unknown public model", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "internal/not-exposed",
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(404);

    expect(response.body).toEqual({
      error: {
        message: "Model 'internal/not-exposed' was not found.",
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
  });

  it("returns a JSON error before opening SSE when a streaming request is invalid", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "internal/not-exposed",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(404);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({
      error: {
        message: "Model 'internal/not-exposed' was not found.",
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
  });

  it("rejects attempts to expose the internal delegate_llm tool from the client request", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "route/default",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            type: "function",
            function: {
              name: "delegate_llm",
              description: "attempt to call an internal gateway tool",
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "delegate_llm" },
        },
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        message:
          "delegate_llm is an internal tool and cannot be supplied by the client.",
        type: "invalid_request_error",
        param: "tools",
        code: "invalid_request",
      },
    });
  });

  it("rejects external client tools unless the active route explicitly allows them", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "route/default",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup_weather",
              description: "external tool",
            },
          },
        ],
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        message: "Client tools are not enabled for route 'default'.",
        type: "invalid_request_error",
        param: "tools",
        code: "invalid_request",
      },
    });
  });

  it("returns a Chat Completions envelope for non-streaming requests", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "route/default",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.2,
        max_tokens: 32,
      })
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({
      id: expect.stringMatching(/^chatcmpl_/),
      object: "chat.completion",
      created: expect.any(Number),
      model: "route/default",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Open Fusion received 1 message for route/default.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  });

  it("accepts supported OpenAI-compatible optional fields and ignores unknown fields safely", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "route/default",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
        temperature: 0.1,
        top_p: 0.8,
        max_tokens: 8,
        stop: ["done"],
        tools: [],
        tool_choice: "none",
        metadata: { request: "contract" },
        unsupported_vendor_field: "ignored",
      })
      .expect(200);

    expect(response.body.object).toBe("chat.completion");
    expect(JSON.stringify(response.body)).not.toContain(
      "unsupported_vendor_field",
    );
  });

  it("streams Chat Completions chunks and terminates with data: [DONE]", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .send({
        model: "route/default",
        stream: true,
        messages: [{ role: "user", content: "stream please" }],
      })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain('"object":"chat.completion.chunk"');
    expect(response.text).toContain('"delta":{"role":"assistant"');
    expect(accumulateStreamContent(response.text)).toBe(
      "Open Fusion received 1 message for route/default.",
    );
    expect(response.text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("streams delegated model output when the orchestrator routes a streaming request", async () => {
    const delegatedApp = await createAppWithGenerationPort(
      DelegatingStreamGenerationPort,
    );

    try {
      const response = await request(delegatedApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .send({
          model: "route/default",
          stream: true,
          messages: [{ role: "user", content: "route this request" }],
        })
        .expect(200);

      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(accumulateStreamContent(response.text)).toBe(
        "delegated streamed answer",
      );
      expect(response.text).not.toContain("delegate_llm");
      expect(response.text.trim().endsWith("data: [DONE]")).toBe(true);
    } finally {
      await delegatedApp.close();
    }
  });

  it("routes coding streaming requests to the coding-capable delegate even when the orchestrator answers directly", async () => {
    const codingConfig = minimalConfig();
    codingConfig.models["worker.fast"].capabilities = ["code", "general"];
    const delegatedApp = await createAppWithGenerationPort(
      CodingFallbackGenerationPort,
      codingConfig,
    );

    try {
      const response = await request(delegatedApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .send({
          model: "route/default",
          stream: true,
          messages: [
            {
              role: "user",
              content: "faça um codigo python para printar hello world",
            },
          ],
        })
        .expect(200);

      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(accumulateStreamContent(response.text)).toBe(
        "print('hello world')",
      );
      expect(response.text.trim().endsWith("data: [DONE]")).toBe(true);
    } finally {
      await delegatedApp.close();
    }
  });

  it("does not expose pre-final agent outputs or graph metadata in SSE chunks", async () => {
    const graphApp = await createAppWithGenerationPort(
      PreFinalTraceGenerationPort,
    );

    try {
      const response = await request(graphApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .send({
          model: "route/default",
          stream: true,
          messages: [{ role: "user", content: "stream with internal prep" }],
        })
        .expect(200);

      expect(accumulateStreamContent(response.text)).toBe(
        "client visible final",
      );
      expectNoInternalRoutingDetails(response.text, [
        "worker.fast",
        "orchestrator.default",
        "fast_draft",
        "collect private context",
        "collect private audit",
        "RAW_PREFINAL_RESULT",
        "EXECUTION_GRAPH_METADATA",
      ]);
      expect(response.text.trim().endsWith("data: [DONE]")).toBe(true);
    } finally {
      await graphApp.close();
    }
  });

  it("returns a sanitized OpenAI error when routing graph validation fails before SSE", async () => {
    const routeId = "sensitive-route-007";
    const publicModel = "route/sanitized-routing";
    const graphApp = await createAppWithGenerationPort(
      InvalidRoutingGraphGenerationPort,
      configWithSensitiveRouteId(routeId, publicModel),
    );

    try {
      const response = await request(graphApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .send({
          model: publicModel,
          stream: true,
          messages: [{ role: "user", content: "stream with invalid graph" }],
        });

      expect([400, 500, 502]).toContain(response.status);
      expect(response.headers["content-type"]).toContain("application/json");
      expectOpenAiErrorEnvelope(response.body);
      expect(response.text).not.toContain("data:");
      expectNoInternalRoutingDetails(JSON.stringify(response.body), [
        routeId,
        "private_capability",
        "capabilities",
        "Execution graph",
        "duplicate agent task",
      ]);
    } finally {
      await graphApp.close();
    }
  });

  it("returns a JSON error before opening SSE when streaming orchestration fails before the first chunk", async () => {
    const failingApp = await createAppWithGenerationPort(
      FailingBeforeFirstChunkGenerationPort,
    );

    try {
      const response = await request(failingApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .send({
          model: "route/default",
          stream: true,
          messages: [{ role: "user", content: "stream please" }],
        })
        .expect(502);

      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.body).toEqual({
        error: {
          message: "Provider failed before streaming began.",
          type: "provider_error",
          param: null,
          code: "provider_error",
        },
      });
      expect(response.text).not.toContain("data:");
    } finally {
      await failingApp.close();
    }
  });

  it("closes SSE without leaking sensitive details when streaming fails after the first chunk", async () => {
    const failingApp = await createAppWithGenerationPort(
      FailingAfterFirstChunkGenerationPort,
    );
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      const response = await request(failingApp.app.getHttpServer())
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer test-gateway-key")
        .set("x-request-id", "req-stream-failure-after-sse")
        .send({
          model: "route/default",
          stream: true,
          messages: [{ role: "user", content: "stream please" }],
        })
        .expect(200);

      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(response.text).toContain("partial final");
      expect(response.text.trim().endsWith("data: [DONE]")).toBe(true);
      expect(response.text).not.toContain("sk-provider-secret");
      expect(response.text).not.toContain("Provider failed after streaming");
      expect(response.text).not.toContain("provider_error");

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"chat_completion.failed"'),
      );
      const serializedLogs = logSpy.mock.calls.flat().join("\n");
      expect(serializedLogs).toContain(
        '"requestId":"req-stream-failure-after-sse"',
      );
      expect(serializedLogs).toContain('"stream":true');
      expect(serializedLogs).toContain('"status":"error"');
      expect(serializedLogs).toContain('"type":"provider_error"');
      expect(serializedLogs).toContain('"code":"provider_error"');
      expect(serializedLogs).toContain('"status":502');
      expect(serializedLogs).not.toContain("sk-provider-secret");
      expect(serializedLogs).not.toContain("Provider failed after streaming");
    } finally {
      logSpy.mockRestore();
      await failingApp.close();
    }
  });

  it("logs structured completion metadata without full prompts or responses", async () => {
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer test-gateway-key")
      .set("x-request-id", "req-log-001")
      .send({
        model: "route/default",
        messages: [{ role: "user", content: "full prompt must not be logged" }],
      })
      .expect(200);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"chat_completion.completed"'),
    );
    const serializedLogs = logSpy.mock.calls.flat().join("\n");
    expect(serializedLogs).toContain('"requestId":"req-log-001"');
    expect(serializedLogs).toContain('"publicModel":"route/default"');
    expect(serializedLogs).not.toContain("full prompt must not be logged");
    expect(serializedLogs).not.toContain("Open Fusion received");

    logSpy.mockRestore();
  });
});

async function createAppWithGenerationPort(
  generationPort: new () => LlmGenerationPort,
  rawConfig: RawGatewayConfig = minimalConfig(),
): Promise<{ app: INestApplication; close: () => Promise<void> }> {
  const previousEnv = { ...process.env };
  const config = writeConfig(rawConfig);
  process.env.OPEN_FUSION_CONFIG = config.path;
  Object.assign(process.env, validEnv());

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(LLM_GENERATION_PORT)
    .useClass(generationPort)
    .compile();

  const app = moduleRef.createNestApplication({
    bodyParser: false,
  });
  configureHttpApp(app);
  await app.init();

  return {
    app,
    async close() {
      await app.close();
      config.cleanup();
      restoreProcessEnv(previousEnv);
    },
  };
}

function restoreProcessEnv(previousEnv: NodeJS.ProcessEnv): void {
  Object.keys(process.env).forEach((key) => {
    if (!(key in previousEnv)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, previousEnv);
}

function createRoutingDecision(input: {
  targetModel: string;
  matchedCapability: string;
  preFinalTasks?: RoutingDecision["pre_final_tasks"];
}): RoutingDecision {
  return {
    final_target: {
      type: "delegate",
      target_model: input.targetModel,
      matched_capability: input.matchedCapability,
      reason: "Selected by the e2e fake routing decision.",
    },
    pre_final_tasks: input.preFinalTasks ?? [],
  };
}

function firstDelegateRoutingDecision(
  request: LlmRoutingDecisionRequest,
): RoutingDecision {
  const delegate = request.delegateModels[0];
  return createRoutingDecision({
    targetModel: delegate.id,
    matchedCapability: delegate.capabilities[0] ?? "general",
  });
}

function configWithSensitiveRouteId(
  routeId: string,
  publicModel: string,
): RawGatewayConfig {
  const rawConfig = minimalConfig();
  rawConfig.auth.apiKeys = rawConfig.auth.apiKeys.map((apiKey) =>
    apiKey.id === "local-dev"
      ? { ...apiKey, allowedRoutes: [routeId] }
      : apiKey,
  );
  rawConfig.routes = {
    [routeId]: {
      ...rawConfig.routes.default,
      publicModel,
    },
  };
  return rawConfig;
}

const internalRoutingTrace =
  "worker.secret orchestrator.secret target_model matched_capability depends_on sensitive-route-007 private_capability capabilities";

class FailingBeforeFirstChunkGenerationPort implements LlmGenerationPort {
  async generateRoutingDecision(): Promise<RoutingDecision> {
    throw OpenAiHttpError.providerError(
      "Provider failed before streaming began.",
    );
  }

  async generate(): Promise<LlmGenerateResult> {
    throw OpenAiHttpError.providerError(
      "Provider failed before streaming began.",
    );
  }

  async *stream(): AsyncIterable<LlmStreamChunk> {
    throw OpenAiHttpError.providerError(
      "Stream should not start before planning completes.",
    );
    yield {
      content: "",
      finishReason: "stop",
    };
  }
}

class InvalidRoutingGraphGenerationPort implements LlmGenerationPort {
  async generateRoutingDecision(): Promise<RoutingDecision> {
    return createRoutingDecision({
      targetModel: "worker.fast",
      matchedCapability: "general",
      preFinalTasks: [
        {
          task_id: internalRoutingTrace,
          target_model: "worker.fast",
          matched_capability: "general",
          task: "collect private context",
          depends_on: [],
        },
        {
          task_id: internalRoutingTrace,
          target_model: "worker.fast",
          matched_capability: "general",
          task: "collect private audit",
          depends_on: [],
        },
      ],
    });
  }

  async generate(): Promise<LlmGenerateResult> {
    throw OpenAiHttpError.providerError(
      "Internal pre-final tasks should not run after invalid graph validation.",
    );
  }

  async *stream(): AsyncIterable<LlmStreamChunk> {
    throw OpenAiHttpError.providerError(
      "Final streaming should not start after invalid graph validation.",
    );
    yield {
      content: "",
      finishReason: "stop",
    };
  }
}

class DelegatingStreamGenerationPort implements LlmGenerationPort {
  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    return firstDelegateRoutingDecision(request);
  }

  async generate(): Promise<LlmGenerateResult> {
    return {
      content: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1",
          name: "delegate_llm",
          arguments: {
            target_model: "worker.fast",
            task: "produce the final streamed answer",
          },
        },
      ],
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    if (request.modelId !== "worker.fast") {
      throw OpenAiHttpError.providerError("Expected delegate stream.");
    }

    yield {
      content: "delegated ",
      finishReason: null,
    };
    yield {
      content: "streamed answer",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
      usage: {
        promptTokens: 4,
        completionTokens: 5,
        totalTokens: 9,
      },
    };
  }
}

class CodingFallbackGenerationPort implements LlmGenerationPort {
  async generateRoutingDecision(): Promise<RoutingDecision> {
    return createRoutingDecision({
      targetModel: "worker.fast",
      matchedCapability: "code",
    });
  }

  async generate(): Promise<LlmGenerateResult> {
    return {
      content: "orchestrator direct answer must not be streamed",
      finishReason: "stop",
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    if (request.modelId !== "worker.fast") {
      throw OpenAiHttpError.providerError("Expected code delegate stream.");
    }

    yield {
      content: "print('hello world')",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
      usage: {
        promptTokens: 4,
        completionTokens: 5,
        totalTokens: 9,
      },
    };
  }
}

class PreFinalTraceGenerationPort implements LlmGenerationPort {
  async generateRoutingDecision(): Promise<RoutingDecision> {
    return createRoutingDecision({
      targetModel: "worker.fast",
      matchedCapability: "general",
      preFinalTasks: [
        {
          task_id: "context",
          target_model: "worker.fast",
          matched_capability: "general",
          task: "collect private context",
          depends_on: [],
        },
        {
          task_id: "audit",
          target_model: "worker.fast",
          matched_capability: "general",
          task: "collect private audit",
          depends_on: [],
        },
      ],
    });
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    if (request.role === "orchestrator") {
      return {
        content: "EXECUTION_GRAPH_METADATA should stay internal",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_context",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "collect private context",
              task_id: "context",
              final: false,
            },
          },
          {
            id: "call_audit",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "collect private audit",
              task_id: "audit",
              final: false,
            },
          },
        ],
      };
    }

    return {
      content: `RAW_PREFINAL_RESULT for ${request.messages[0]?.content}`,
      finishReason: "stop",
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    if (request.modelId !== "worker.fast") {
      throw OpenAiHttpError.providerError("Expected final delegate stream.");
    }
    if (!request.toolResults || request.toolResults.length !== 2) {
      throw OpenAiHttpError.providerError(
        "Expected internal pre-final tool results before streaming.",
      );
    }

    yield {
      content: "client visible final",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
      usage: {
        promptTokens: 2,
        completionTokens: 3,
        totalTokens: 5,
      },
    };
  }
}

class FailingAfterFirstChunkGenerationPort implements LlmGenerationPort {
  private generateCalls = 0;

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    return firstDelegateRoutingDecision(request);
  }

  async generate(): Promise<LlmGenerateResult> {
    this.generateCalls += 1;

    if (this.generateCalls === 1) {
      return {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "delegate_llm",
            arguments: {
              target_model: "worker.fast",
              task: "draft before streaming",
            },
          },
        ],
      };
    }

    return {
      content: "delegate draft",
      finishReason: "stop",
    };
  }

  async *stream(): AsyncIterable<LlmStreamChunk> {
    yield {
      content: "partial final",
      finishReason: null,
    };
    throw OpenAiHttpError.providerError(
      "Provider failed after streaming with sk-provider-secret.",
    );
  }
}

function accumulateStreamContent(streamBody: string): string {
  return streamBody
    .split("\n\n")
    .map((event) => event.trim())
    .filter((event) => event.startsWith("data: "))
    .map((event) => event.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map(
      (data) =>
        JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        },
    )
    .map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
    .join("");
}

function expectOpenAiErrorEnvelope(body: unknown): void {
  expect(body).toHaveProperty("error");
  const error = (body as { error?: Record<string, unknown> }).error;
  expect(error).toBeDefined();
  expect(error?.message).toEqual(expect.any(String));
  expect(error?.type).toEqual(expect.any(String));
  expect(error).toHaveProperty("param");
  expect(error?.param === null || typeof error?.param === "string").toBe(true);
  expect(error?.code).toEqual(expect.any(String));
}

function expectNoInternalRoutingDetails(
  serialized: string,
  additionalTokens: string[] = [],
): void {
  [
    "worker.",
    "orchestrator.",
    "target_model",
    "targetModel",
    "matched_capability",
    "matchedCapability",
    "matched capability",
    "depends_on",
    "dependsOn",
    "delegate_llm",
    "final_target",
    "pre_final_tasks",
    "task_id",
    "toolResults",
    "untrusted",
    "Model:",
    "Task:",
    "LatencyMs",
    "FinishReason",
    "Usage",
    ...additionalTokens,
  ].forEach((token) => {
    expect(serialized).not.toContain(token);
  });
}
