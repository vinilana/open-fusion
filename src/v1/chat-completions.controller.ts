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

    const startedAt = Date.now();

    let context: ChatCompletionRequestContext | undefined;
    let sseStarted = false;

    try {
      context = this.completions.createRequestContext(
        body,
        client,
        request.requestId ?? "",
      );

      if (context.stream) {
        for await (const chunk of this.completions.streamRequest(context)) {
          const event = `data: ${JSON.stringify(chunk)}\n\n`;
          if (!sseStarted) {
            this.openSseResponse(response);
          }
          response.write(event);
          sseStarted = true;
        }

        if (!sseStarted) {
          this.openSseResponse(response);
        }
        this.logSuccess(context, client.id, startedAt);
        response.end("data: [DONE]\n\n");
        return;
      }

      const completion = await this.completions.completeRequest(context);
      this.logSuccess(context, client.id, startedAt, completion);
      response.status(200).json(completion);
    } catch (error) {
      this.logFailure(
        context,
        body,
        client.id,
        request.requestId ?? "",
        startedAt,
        error,
      );
      const isStreamFailure =
        context?.stream ?? this.completions.isStreamingRequest(body);
      if (isStreamFailure && (sseStarted || response.headersSent)) {
        if (!response.writableEnded) {
          response.end("data: [DONE]\n\n");
        }
        return;
      }
      throw error;
    }
  }

  private openSseResponse(response: Response): void {
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
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
    context: ChatCompletionRequestContext | undefined,
    body: unknown,
    clientId: string,
    requestId: string,
    startedAt: number,
    error: unknown,
  ): void {
    this.operationalLogger.logChatCompletion({
      event: "chat_completion.failed",
      requestId: context?.requestId ?? requestId,
      clientId,
      routeId: context?.routeId ?? "",
      publicModel: context?.publicModel ?? getRequestedModel(body),
      orchestrator: context?.orchestrator ?? "",
      stream: context?.stream ?? this.completions.isStreamingRequest(body),
      status: "error",
      latencyMs: elapsedMs(startedAt),
      error: this.operationalLogger.normalizeError(error),
    });
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function getRequestedModel(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "model" in body &&
    typeof (body as { model?: unknown }).model === "string"
  ) {
    return (body as { model: string }).model;
  }

  return "";
}
