import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Optional,
} from "@nestjs/common";
import { Request, Response } from "express";

import { GatewayConfigService } from "../config/gateway-config.service";
import { OperationalLoggerService } from "../ops/operational-logger.service";
import { OpenAiHttpError } from "./openai-http-error";

@Catch()
export class OpenAiErrorFilter implements ExceptionFilter {
  constructor(
    private readonly config: GatewayConfigService,
    @Optional()
    private readonly operationalLogger?: OperationalLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const error = this.normalize(exception);

    this.logHttpFailure(request, error);
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
      `Request payload exceeds the configured limit of ${this.config.getHttpMaxPayloadBytes()} bytes.`,
    );
  }

  private logHttpFailure(request: Request, error: OpenAiHttpError): void {
    if (!request.path.startsWith("/v1/")) {
      return;
    }

    this.operationalLogger?.logHttpRequest({
      event: "http_request.failed",
      requestId: request.requestId ?? "",
      clientId: request.authenticatedClient?.id,
      method: request.method,
      path: request.path,
      status: "error",
      statusCode: error.status,
      latencyMs: elapsedMs(request.startedAt),
      error: {
        type: error.type,
        code: error.code,
        param: error.param,
        status: error.status,
      },
    });
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

function elapsedMs(startedAt: number | undefined): number {
  return Math.max(0, Date.now() - (startedAt ?? Date.now()));
}
