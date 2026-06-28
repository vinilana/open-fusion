import { Controller, Get, Req } from "@nestjs/common";
import { Request } from "express";

import { OpenAiHttpError } from "../errors/openai-http-error";
import { OperationalLoggerService } from "../ops/operational-logger.service";
import { ModelsService } from "./models.service";
import { ModelsResponse } from "./openai-types";

@Controller("v1/models")
export class ModelsController {
  constructor(
    private readonly models: ModelsService,
    private readonly operationalLogger: OperationalLoggerService,
  ) {}

  @Get()
  list(@Req() request: Request): ModelsResponse {
    const client = request.authenticatedClient;
    if (!client) {
      throw OpenAiHttpError.authentication();
    }

    const response = this.models.list(client);

    this.operationalLogger.logHttpRequest({
      event: "http_request.completed",
      requestId: request.requestId ?? "",
      clientId: client.id,
      method: request.method,
      path: request.path,
      status: "success",
      statusCode: 200,
      latencyMs: elapsedMs(request.startedAt),
    });

    return response;
  }
}

function elapsedMs(startedAt: number | undefined): number {
  return Math.max(0, Date.now() - (startedAt ?? Date.now()));
}
