import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

import { GatewayConfigService } from "../config/gateway-config.service";
import { OpenAiHttpError } from "./openai-http-error";

@Catch()
export class OpenAiErrorFilter implements ExceptionFilter {
  constructor(private readonly config: GatewayConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = this.normalize(exception);

    response.status(error.status).json(error.toBody());
  }

  private normalize(exception: unknown): OpenAiHttpError {
    if (exception instanceof OpenAiHttpError) {
      return exception;
    }

    if (isPayloadTooLargeException(exception)) {
      return this.payloadTooLarge();
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.UNAUTHORIZED) {
        return OpenAiHttpError.authentication();
      }
      if (status === HttpStatus.FORBIDDEN) {
        return new OpenAiHttpError({
          status,
          message: "Forbidden.",
          type: "invalid_request_error",
          code: "forbidden",
        });
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        return this.payloadTooLarge();
      }
      return new OpenAiHttpError({
        status,
        message: exception.message,
        type: status >= 500 ? "server_error" : "invalid_request_error",
        code: status >= 500 ? "internal_error" : "invalid_request",
      });
    }

    return OpenAiHttpError.internal();
  }

  private payloadTooLarge(): OpenAiHttpError {
    return OpenAiHttpError.rateLimited(
      `Request payload exceeds the configured limit of ${this.config.getMaxPayloadBytes()} bytes.`,
    );
  }
}

function isPayloadTooLargeException(
  exception: unknown,
): exception is { status?: number; type?: string } {
  return (
    typeof exception === "object" &&
    exception !== null &&
    ((typeof (exception as { status?: unknown }).status === "number" &&
      (exception as { status: number }).status ===
        HttpStatus.PAYLOAD_TOO_LARGE) ||
      (typeof (exception as { type?: unknown }).type === "string" &&
        (exception as { type: string }).type === "entity.too.large"))
  );
}
