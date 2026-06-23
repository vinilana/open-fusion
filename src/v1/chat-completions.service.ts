import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { GatewayConfigService } from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";
import {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openai-types";

interface AuthenticatedClient {
  id: string;
  allowedModels: string[];
}

@Injectable()
export class ChatCompletionsService {
  constructor(private readonly config: GatewayConfigService) {}

  complete(body: unknown, client: AuthenticatedClient): ChatCompletionResponse {
    const request = this.validate(body);
    this.assertModelAccess(request.model, client);

    const created = unixTimestamp();
    return {
      id: createCompletionId(),
      object: "chat.completion",
      created,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: this.createStubContent(request),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  stream(body: unknown, client: AuthenticatedClient): ChatCompletionChunk[] {
    const request = this.validate(body);
    this.assertModelAccess(request.model, client);

    const id = createCompletionId();
    const created = unixTimestamp();
    const content = this.createStubContent(request);

    return [
      {
        id,
        object: "chat.completion.chunk",
        created,
        model: request.model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content,
            },
            finish_reason: null,
          },
        ],
      },
      {
        id,
        object: "chat.completion.chunk",
        created,
        model: request.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      },
    ];
  }

  isStreamingRequest(body: unknown): boolean {
    return (
      typeof body === "object" &&
      body !== null &&
      "stream" in body &&
      (body as { stream?: unknown }).stream === true
    );
  }

  private validate(body: unknown): ChatCompletionRequest {
    if (!isRecord(body)) {
      throw OpenAiHttpError.invalidRequest(
        "Request body must be a JSON object.",
      );
    }

    if (typeof body.model !== "string" || body.model.trim().length === 0) {
      throw OpenAiHttpError.invalidRequest(
        "model must be a non-empty string.",
        "model",
      );
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw OpenAiHttpError.invalidRequest(
        "messages must be a non-empty array.",
        "messages",
      );
    }

    for (const [index, message] of body.messages.entries()) {
      if (!isRecord(message)) {
        throw OpenAiHttpError.invalidRequest(
          `messages[${index}] must be an object.`,
          "messages",
        );
      }
      if (
        !["system", "user", "assistant", "tool"].includes(String(message.role))
      ) {
        throw OpenAiHttpError.invalidRequest(
          `messages[${index}].role is not supported.`,
          "messages",
        );
      }
      if (
        "content" in message &&
        message.content !== null &&
        typeof message.content !== "string"
      ) {
        throw OpenAiHttpError.invalidRequest(
          `messages[${index}].content must be a string or null.`,
          "messages",
        );
      }
    }

    if ("stream" in body && typeof body.stream !== "boolean") {
      throw OpenAiHttpError.invalidRequest(
        "stream must be a boolean.",
        "stream",
      );
    }

    this.validateNumber(body, "temperature");
    this.validateNumber(body, "top_p");
    this.validateNumber(body, "max_tokens");

    if (
      "stop" in body &&
      typeof body.stop !== "string" &&
      (!Array.isArray(body.stop) ||
        body.stop.some((item) => typeof item !== "string"))
    ) {
      throw OpenAiHttpError.invalidRequest(
        "stop must be a string or an array of strings.",
        "stop",
      );
    }

    if ("tools" in body && !Array.isArray(body.tools)) {
      throw OpenAiHttpError.invalidRequest("tools must be an array.", "tools");
    }

    if (
      "tool_choice" in body &&
      typeof body.tool_choice !== "string" &&
      !isRecord(body.tool_choice)
    ) {
      throw OpenAiHttpError.invalidRequest(
        "tool_choice must be a string or an object.",
        "tool_choice",
      );
    }

    if ("metadata" in body && !isRecord(body.metadata)) {
      throw OpenAiHttpError.invalidRequest(
        "metadata must be an object.",
        "metadata",
      );
    }

    return {
      model: body.model,
      messages: body.messages as ChatCompletionRequest["messages"],
      stream: body.stream as boolean | undefined,
      temperature: body.temperature as number | undefined,
      top_p: body.top_p as number | undefined,
      max_tokens: body.max_tokens as number | undefined,
      stop: body.stop as string | string[] | undefined,
      tools: body.tools as unknown[] | undefined,
      tool_choice: body.tool_choice as
        | string
        | Record<string, unknown>
        | undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
    };
  }

  private validateNumber(body: Record<string, unknown>, field: string): void {
    if (field in body && typeof body[field] !== "number") {
      throw OpenAiHttpError.invalidRequest(`${field} must be a number.`, field);
    }
  }

  private assertModelAccess(
    modelId: string,
    client: AuthenticatedClient,
  ): void {
    const model = this.config.findPublicModel(modelId);
    if (!model) {
      throw OpenAiHttpError.modelNotFound(modelId);
    }

    if (!client.allowedModels.includes(model.id)) {
      throw OpenAiHttpError.forbidden(modelId);
    }
  }

  private createStubContent(request: ChatCompletionRequest): string {
    return `Open Fusion received ${request.messages.length} message for ${request.model}.`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function createCompletionId(): string {
  return `chatcmpl_${randomUUID().replaceAll("-", "")}`;
}
