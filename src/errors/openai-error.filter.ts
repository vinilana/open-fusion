import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

import { OpenAiHttpError } from "./openai-http-error";

@Catch()
export class OpenAiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = this.normalize(exception);

    response.status(error.status).json(error.toBody());
  }

  private normalize(exception: unknown): OpenAiHttpError {
    if (exception instanceof OpenAiHttpError) {
      return exception;
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
      return new OpenAiHttpError({
        status,
        message: exception.message,
        type: status >= 500 ? "server_error" : "invalid_request_error",
        code: status >= 500 ? "internal_error" : "invalid_request",
      });
    }

    return OpenAiHttpError.internal();
  }
}
