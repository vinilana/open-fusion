import { OpenAiHttpError } from "../src/errors/openai-http-error";
import { redactSensitive } from "../src/errors/redact-sensitive";

describe("OpenAI HTTP error mapping", () => {
  it.each([
    [
      "timeout",
      OpenAiHttpError.timeout("route timeout"),
      408,
      "timeout_error",
      "timeout",
    ],
    [
      "rate limit",
      OpenAiHttpError.rateLimited("too many requests"),
      429,
      "rate_limit_error",
      "rate_limit_exceeded",
    ],
    [
      "provider error",
      OpenAiHttpError.providerError("provider failed"),
      502,
      "provider_error",
      "provider_error",
    ],
    [
      "provider unavailable",
      OpenAiHttpError.providerUnavailable("provider unavailable"),
      503,
      "provider_unavailable",
      "provider_unavailable",
    ],
    [
      "internal",
      OpenAiHttpError.internal("unexpected failure"),
      500,
      "server_error",
      "internal_error",
    ],
  ])(
    "maps %s to an OpenAI-compatible body",
    (_label, error, status, type, code) => {
      expect(error.status).toBe(status);
      expect(error.toBody()).toEqual({
        error: {
          message: expect.any(String),
          type,
          param: null,
          code,
        },
      });
    },
  );

  it("redacts bearer tokens, provider keys, and authorization fields", () => {
    const redacted = redactSensitive(
      "Authorization: Bearer test-gateway-key api_key: sk-provider-secret",
    );

    expect(redacted).toContain("Authorization: Bearer [REDACTED]");
    expect(redacted).toContain("api_key: sk-[REDACTED]");
    expect(redacted).not.toContain("test-gateway-key");
    expect(redacted).not.toContain("sk-provider-secret");
  });
});
