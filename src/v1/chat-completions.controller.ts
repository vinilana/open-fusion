import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";

import { OpenAiHttpError } from "../errors/openai-http-error";
import { ChatCompletionsService } from "./chat-completions.service";

@Controller("v1/chat/completions")
export class ChatCompletionsController {
  constructor(private readonly completions: ChatCompletionsService) {}

  @Post()
  create(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const client = request.authenticatedClient;
    if (!client) {
      throw OpenAiHttpError.authentication();
    }

    if (this.completions.isStreamingRequest(body)) {
      response.status(200);
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");

      for (const chunk of this.completions.stream(body, client)) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      response.end("data: [DONE]\n\n");
      return;
    }

    response.status(200).json(this.completions.complete(body, client));
  }
}
