import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";

import { OpenAiHttpError } from "../errors/openai-http-error";
import { ChatCompletionsService } from "./chat-completions.service";

@Controller("v1/chat/completions")
export class ChatCompletionsController {
  constructor(private readonly completions: ChatCompletionsService) {}

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

    if (this.completions.isStreamingRequest(body)) {
      response.status(200);
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");

      const chunks = await this.completions.stream(body, client);
      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      response.end("data: [DONE]\n\n");
      return;
    }

    response.status(200).json(await this.completions.complete(body, client));
  }
}
