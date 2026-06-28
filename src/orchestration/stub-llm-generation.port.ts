import { Injectable } from "@nestjs/common";

import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
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
}
