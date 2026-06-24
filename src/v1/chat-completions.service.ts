import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import {
  GatewayConfigService,
  RouteConfig,
} from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";
import { LlmFinishReason } from "../orchestration/llm-generation.port";
import { OrchestrationService } from "../orchestration/orchestration.service";
import {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openai-types";

interface AuthenticatedClient {
  id: string;
  allowedModels: string[];
}

export interface ChatCompletionRequestContext {
  requestId: string;
  routeId: string;
  publicModel: string;
  orchestrator: string;
  streamFinalOnly: boolean;
  stream: boolean;
  request: ChatCompletionRequest;
}

@Injectable()
export class ChatCompletionsService {
  constructor(
    private readonly config: GatewayConfigService,
    private readonly orchestration: OrchestrationService,
  ) {}

  createRequestContext(
    body: unknown,
    client: AuthenticatedClient,
    requestId: string,
  ): ChatCompletionRequestContext {
    const request = this.validate(body);
    const route = this.assertModelAccess(request.model, client);
    this.assertClientToolsAllowed(request, route);

    return {
      requestId,
      routeId: route.id,
      publicModel: request.model,
      orchestrator: route.orchestrator,
      streamFinalOnly: route.streamFinalOnly,
      stream: request.stream === true,
      request,
    };
  }

  async complete(
    body: unknown,
    client: AuthenticatedClient,
  ): Promise<ChatCompletionResponse> {
    return this.completeRequest(this.createRequestContext(body, client, ""));
  }

  async completeRequest(
    context: ChatCompletionRequestContext,
  ): Promise<ChatCompletionResponse> {
    const orchestration = await this.orchestration.run(context.request, {
      requestId: context.requestId,
      routeId: context.routeId,
      streamFinalOnly: context.streamFinalOnly,
      clientTools: context.request.tools,
    });
    const created = unixTimestamp();
    return {
      id: createCompletionId(),
      object: "chat.completion",
      created,
      model: context.publicModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: orchestration.content,
          },
          finish_reason: orchestration.finishReason,
        },
      ],
      usage: {
        prompt_tokens: orchestration.usage.promptTokens,
        completion_tokens: orchestration.usage.completionTokens,
        total_tokens: orchestration.usage.totalTokens,
      },
    };
  }

  async stream(
    body: unknown,
    client: AuthenticatedClient,
  ): Promise<ChatCompletionChunk[]> {
    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of this.streamRequest(
      this.createRequestContext(body, client, ""),
    )) {
      chunks.push(chunk);
    }
    return chunks;
  }

  async *streamRequest(
    context: ChatCompletionRequestContext,
  ): AsyncIterable<ChatCompletionChunk> {
    const stream = this.orchestration.streamFinal(context.request, {
      requestId: context.requestId,
      routeId: context.routeId,
      streamFinalOnly: context.streamFinalOnly,
      clientTools: context.request.tools,
    });
    const id = createCompletionId();
    const created = unixTimestamp();
    let roleEmitted = false;

    for await (const chunk of stream) {
      if (chunk.finishReason !== null) {
        if (!roleEmitted) {
          yield createStreamContentChunk(id, created, context.publicModel, "", {
            includeRole: true,
          });
        }
        yield createStreamFinishChunk(
          id,
          created,
          context.publicModel,
          chunk.finishReason,
        );
        return;
      }

      yield createStreamContentChunk(
        id,
        created,
        context.publicModel,
        chunk.content,
        { includeRole: !roleEmitted },
      );
      roleEmitted = true;
    }

    yield createStreamFinishChunk(id, created, context.publicModel, "stop");
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
    if (Array.isArray(body.tools)) {
      this.validateClientTools(body.tools);
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
    if (this.referencesInternalDelegateTool(body.tool_choice)) {
      throw OpenAiHttpError.invalidRequest(
        "delegate_llm is an internal tool and cannot be supplied by the client.",
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

  private validateClientTools(tools: unknown[]): void {
    for (const [index, tool] of tools.entries()) {
      if (!isRecord(tool)) {
        throw OpenAiHttpError.invalidRequest(
          `tools[${index}] must be an object.`,
          "tools",
        );
      }

      if (this.referencesInternalDelegateTool(tool)) {
        throw OpenAiHttpError.invalidRequest(
          "delegate_llm is an internal tool and cannot be supplied by the client.",
          "tools",
        );
      }
    }
  }

  private referencesInternalDelegateTool(value: unknown): boolean {
    if (!isRecord(value)) {
      return false;
    }

    if (value.name === "delegate_llm") {
      return true;
    }

    if (isRecord(value.function) && value.function.name === "delegate_llm") {
      return true;
    }

    return false;
  }

  private assertModelAccess(
    modelId: string,
    client: AuthenticatedClient,
  ): RouteConfig {
    const model = this.config.findPublicModel(modelId);
    if (!model) {
      throw OpenAiHttpError.modelNotFound(modelId);
    }

    if (!client.allowedModels.includes(model.id)) {
      throw OpenAiHttpError.forbidden(modelId);
    }

    const route = this.config.resolveRouteByPublicModel(modelId);
    if (!route) {
      throw OpenAiHttpError.modelNotFound(modelId);
    }

    return route;
  }

  private assertClientToolsAllowed(
    request: ChatCompletionRequest,
    route: RouteConfig,
  ): void {
    if (
      request.tools !== undefined &&
      request.tools.length > 0 &&
      !route.allowClientTools
    ) {
      throw OpenAiHttpError.invalidRequest(
        `Client tools are not enabled for route '${route.id}'.`,
        "tools",
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function createStreamContentChunk(
  id: string,
  created: number,
  model: string,
  content: string,
  options: { includeRole: boolean },
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {
          ...(options.includeRole ? { role: "assistant" as const } : {}),
          content,
        },
        finish_reason: null,
      },
    ],
  };
}

function createStreamFinishChunk(
  id: string,
  created: number,
  model: string,
  finishReason: LlmFinishReason,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
}

function createCompletionId(): string {
  return `chatcmpl_${randomUUID().replaceAll("-", "")}`;
}
