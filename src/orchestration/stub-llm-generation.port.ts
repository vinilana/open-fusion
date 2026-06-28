import { Injectable } from "@nestjs/common";

import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
  LlmRoutingDecisionRequest,
  LlmStreamChunk,
  RoutingDecision,
} from "./llm-generation.port";

@Injectable()
export class StubLlmGenerationPort implements LlmGenerationPort {
  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    const delegate = request.delegateModels[0];
    if (!delegate) {
      return {
        final_target: {
          type: "orchestrator_fallback",
          reason: "No delegate is available in the stub catalog.",
        },
        pre_final_tasks: [],
      };
    }

    return {
      final_target: {
        type: "delegate",
        target_model: delegate.id,
        matched_capability: delegate.capabilities[0] ?? "general",
        reason: "Stub routing decision.",
      },
      pre_final_tasks: [],
    };
  }

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
