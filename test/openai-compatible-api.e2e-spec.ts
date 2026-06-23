import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { LLM_GENERATION_PORT } from "../src/orchestration/llm-generation.port";
import { StubLlmGenerationPort } from "../src/orchestration/stub-llm-generation.port";
import { validEnv, writeConfig } from "./support/gateway-config.fixture";

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

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    cleanupConfig?.();
    process.env = previousEnv;
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

  it("rejects invalid bearer tokens without echoing the token", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/models")
      .set("Authorization", "Bearer invalid-secret-token")
      .expect(401);

    expect(JSON.stringify(response.body)).not.toContain("invalid-secret-token");
    expect(response.body.error.code).toBe("invalid_api_key");
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
    expect(response.text.trim().endsWith("data: [DONE]")).toBe(true);
  });
});
