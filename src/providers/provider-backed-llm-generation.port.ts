import { Injectable } from "@nestjs/common";

import { GatewayConfigService } from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmGenerationPort,
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
      throw OpenAiHttpError.providerError(
        `Configured model '${request.modelId}' was not found.`,
      );
    }

    return this.providers.generate(model, request);
  }
}
