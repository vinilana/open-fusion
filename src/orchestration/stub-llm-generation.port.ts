import { Injectable } from "@nestjs/common";

import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
  LlmStreamChunk,
} from "./llm-generation.port";

@Injectable()
export class StubLlmGenerationPort implements LlmGenerationPort {
  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    return {
      content: `Open Fusion received ${request.messages.length} message for ${request.publicModelId}.`,
      finishReason: "stop",
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }

  async *stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    yield {
      content: `Open Fusion received ${request.messages.length} message for `,
      finishReason: null,
    };
    yield {
      content: request.publicModelId,
      finishReason: null,
    };
    yield {
      content: ".",
      finishReason: null,
    };
    yield {
      content: "",
      finishReason: "stop",
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }
}
