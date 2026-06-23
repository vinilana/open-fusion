import { randomUUID } from "node:crypto";

import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header("x-request-id");
    const requestId = this.isValidRequestId(incoming) ? incoming : randomUUID();

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }

  private isValidRequestId(value: string | undefined): value is string {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_REQUEST_ID_LENGTH &&
      REQUEST_ID_PATTERN.test(value)
    );
  }
}
