import { Injectable } from "@nestjs/common";

import { GatewayConfigService } from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
  LlmRoutingDecisionRequest,
  LlmStreamChunk,
  RoutingDecision,
} from "../orchestration/llm-generation.port";
import { ProviderRegistry } from "./provider-registry";

@Injectable()
export class ProviderBackedLlmGenerationPort implements LlmGenerationPort {
  constructor(
    private readonly config: GatewayConfigService,
    private readonly providers: ProviderRegistry,
  ) {}

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const model = this.config.findInternalModel(request.modelId);
    if (!model) {
      throw OpenAiHttpError.internal(
        "Configured internal model was not found.",
      );
    }

    return this.providers.generate(model, request);
  }

  async generateRoutingDecision(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    const model = this.config.findInternalModel(request.modelId);
    if (!model) {
      throw OpenAiHttpError.internal(
        "Configured internal model was not found.",
      );
    }

    return this.providers.generateRoutingDecision(model, request);
  }

  stream(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk> {
    const model = this.config.findInternalModel(request.modelId);
    if (!model) {
      throw OpenAiHttpError.internal(
        "Configured internal model was not found.",
      );
    }

    return this.providers.stream(model, request);
  }
}
