import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";

import { OpenAiHttpError } from "../errors/openai-http-error";
import { OperationalLoggerService } from "../ops/operational-logger.service";
import {
  ChatCompletionRequestContext,
  ChatCompletionsService,
} from "./chat-completions.service";
import { ChatCompletionResponse } from "./openai-types";

@Controller("v1/chat/completions")
export class ChatCompletionsController {
  constructor(
    private readonly completions: ChatCompletionsService,
    private readonly operationalLogger: OperationalLoggerService,
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const client = request.authenticatedClient;
    if (!client) {
      throw OpenAiHttpError.authentication();
    }

    const context = this.completions.createRequestContext(
      body,
      client,
      request.requestId ?? "",
    );

    const startedAt = Date.now();

    try {
      if (context.stream) {
        const chunks = await this.completions.streamRequest(context);

        this.logSuccess(context, client.id, startedAt);

        response.status(200);
        response.setHeader("content-type", "text/event-stream; charset=utf-8");
        response.setHeader("cache-control", "no-cache, no-transform");
        response.setHeader("connection", "keep-alive");

        for (const chunk of chunks) {
          response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        response.end("data: [DONE]\n\n");
        return;
      }

      const completion = await this.completions.completeRequest(context);
      this.logSuccess(context, client.id, startedAt, completion);
      response.status(200).json(completion);
    } catch (error) {
      this.logFailure(context, client.id, startedAt, error);
      throw error;
    }
  }

  private logSuccess(
    context: ChatCompletionRequestContext,
    clientId: string,
    startedAt: number,
    completion?: ChatCompletionResponse,
  ): void {
    this.operationalLogger.logChatCompletion({
      event: "chat_completion.completed",
      requestId: context.requestId,
      clientId,
      routeId: context.routeId,
      publicModel: context.publicModel,
      orchestrator: context.orchestrator,
      stream: context.stream,
      status: "success",
      latencyMs: elapsedMs(startedAt),
      usage: completion?.usage,
    });
  }

  private logFailure(
    context: ChatCompletionRequestContext,
    clientId: string,
    startedAt: number,
    error: unknown,
  ): void {
    this.operationalLogger.logChatCompletion({
      event: "chat_completion.failed",
      requestId: context.requestId,
      clientId,
      routeId: context.routeId,
      publicModel: context.publicModel,
      orchestrator: context.orchestrator,
      stream: context.stream,
      status: "error",
      latencyMs: elapsedMs(startedAt),
      error: this.operationalLogger.normalizeError(error),
    });
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
