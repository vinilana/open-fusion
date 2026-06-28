import { OpenAiErrorBody, OpenAiErrorDetails } from "./openai-error";
import { redactSensitive } from "./redact-sensitive";

export class OpenAiHttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly param: string | null;
  readonly code: string;

  constructor(details: OpenAiErrorDetails) {
    super(redactSensitive(details.message));
    this.status = details.status;
    this.type = details.type;
    this.param = details.param ?? null;
    this.code = details.code;
  }

  toBody(): OpenAiErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        param: this.param,
        code: this.code,
      },
    };
  }

  static invalidRequest(
    message: string,
    param: string | null = null,
  ): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 400,
      message,
      type: "invalid_request_error",
      param,
      code: "invalid_request",
    });
  }

  static authentication(): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 401,
      message: "Missing or invalid bearer token.",
      type: "authentication_error",
      code: "invalid_api_key",
    });
  }

  static forbidden(model: string): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 403,
      message: `Client is not allowed to access model '${model}'.`,
      type: "invalid_request_error",
      param: "model",
      code: "model_not_allowed",
    });
  }

  static modelNotFound(model: string): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 404,
      message: `Model '${model}' was not found.`,
      type: "invalid_request_error",
      param: "model",
      code: "model_not_found",
    });
  }

  static timeout(message = "The request timed out."): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 408,
      message,
      type: "timeout_error",
      code: "timeout",
    });
  }

  static rateLimited(
    message = "Rate limit exceeded.",
    param: string | null = null,
  ): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 429,
      message,
      type: "rate_limit_error",
      param,
      code: "rate_limit_exceeded",
    });
  }

  static providerError(
    message = "The provider failed to complete the request.",
  ): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 502,
      message,
      type: "provider_error",
      code: "provider_error",
    });
  }

  static providerUnavailable(
    message = "The provider is unavailable.",
  ): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 503,
      message,
      type: "provider_unavailable",
      code: "provider_unavailable",
    });
  }

  static internal(message = "Internal server error."): OpenAiHttpError {
    return new OpenAiHttpError({
      status: 500,
      message,
      type: "server_error",
      code: "internal_error",
    });
  }
}
