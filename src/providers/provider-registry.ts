import { Injectable } from "@nestjs/common";

import {
  GatewayConfigService,
  InternalModelConfig,
} from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
} from "../orchestration/llm-generation.port";
import { OpenRouterAdapter } from "./openrouter.adapter";

@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly config: GatewayConfigService,
    private readonly openRouter: OpenRouterAdapter,
  ) {}

  async generate(
    model: InternalModelConfig,
    request: LlmGenerateRequest,
  ): Promise<LlmGenerateResult> {
    const provider = this.config.getProvider(model.provider);
    if (!provider) {
      throw OpenAiHttpError.providerError(
        `Provider '${model.provider}' is not configured.`,
      );
    }

    if (provider.type === this.openRouter.type) {
      return this.openRouter.generate(provider, model, request);
    }

    throw OpenAiHttpError.providerError(
      `Provider type '${provider.type}' is not supported.`,
    );
  }
}
