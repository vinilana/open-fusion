import { GatewayConfigService } from "../src/config/gateway-config.service";
import { OpenAiHttpError } from "../src/errors/openai-http-error";
import { OrchestrationService } from "../src/orchestration/orchestration.service";
import { ChatCompletionsService } from "../src/v1/chat-completions.service";
import { minimalConfig, validEnv } from "./support/gateway-config.fixture";

describe("ChatCompletionsService request validation", () => {
  it.each([
    ["temperature", NaN],
    ["top_p", Infinity],
    ["max_tokens", -Infinity],
  ])("rejects non-finite numeric field %s", (field, value) => {
    const service = createService();

    expect(() =>
      service.createRequestContext(
        {
          model: "route/default",
          messages: [{ role: "user", content: "hello" }],
          [field]: value,
        },
        createClient(),
        "req-validation",
      ),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "invalid_request",
        param: field,
      } satisfies Partial<OpenAiHttpError>),
    );
  });

  it("rejects requests that exceed the configured message count limit", () => {
    const service = createService({
      maxMessages: 1,
    });

    expect(() =>
      service.createRequestContext(
        {
          model: "route/default",
          messages: [
            { role: "user", content: "first" },
            { role: "user", content: "second" },
          ],
        },
        createClient(),
        "req-message-count",
      ),
    ).toThrow(
      expect.objectContaining({
        status: 429,
        code: "rate_limit_exceeded",
        param: "messages",
      } satisfies Partial<OpenAiHttpError>),
    );
  });

  it("rejects requests that exceed the configured message content limit", () => {
    const service = createService({
      maxMessageContentLength: 4,
    });

    expect(() =>
      service.createRequestContext(
        {
          model: "route/default",
          messages: [{ role: "user", content: "hello" }],
        },
        createClient(),
        "req-message-content",
      ),
    ).toThrow(
      expect.objectContaining({
        status: 429,
        code: "rate_limit_exceeded",
        param: "messages",
      } satisfies Partial<OpenAiHttpError>),
    );
  });

  it("rejects requests that exceed the configured JSON payload byte limit", () => {
    const service = createService({
      maxPayloadBytes: 80,
    });

    expect(() =>
      service.createRequestContext(
        {
          model: "route/default",
          messages: [{ role: "user", content: "payload too large" }],
        },
        createClient(),
        "req-payload-size",
      ),
    ).toThrow(
      expect.objectContaining({
        status: 429,
        code: "rate_limit_exceeded",
        param: null,
      } satisfies Partial<OpenAiHttpError>),
    );
  });
});

function createService(
  routeLimits: {
    maxMessages?: number;
    maxMessageContentLength?: number;
    maxPayloadBytes?: number;
  } = {},
): ChatCompletionsService {
  const rawConfig = minimalConfig();
  Object.assign(rawConfig.routes.default, routeLimits);
  const config = new GatewayConfigService({
    rawConfig,
    env: validEnv(),
  });

  return new ChatCompletionsService(
    config,
    {} as unknown as OrchestrationService,
  );
}

function createClient() {
  return {
    id: "local-dev",
    allowedModels: ["route/default"],
  };
}
