import { Injectable } from "@nestjs/common";

import {
  GatewayConfigService,
  InternalModelConfig,
  ProviderConfig,
} from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmRoutingDecisionRequest,
  LlmStreamChunk,
  RoutingDecision,
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
    const provider = this.resolveOpenRouterProvider(model);

    return this.openRouter.generate(provider, model, request);
  }

  async generateRoutingDecision(
    model: InternalModelConfig,
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision> {
    const provider = this.resolveOpenRouterProvider(model);

    return this.openRouter.generateRoutingDecision(provider, model, request);
  }

  stream(
    model: InternalModelConfig,
    request: LlmGenerateRequest,
  ): AsyncIterable<LlmStreamChunk> {
    const provider = this.resolveOpenRouterProvider(model);
    if (!this.openRouter.stream) {
      throw OpenAiHttpError.internal();
    }

    return this.openRouter.stream(provider, model, request);
  }

  private resolveOpenRouterProvider(
    model: InternalModelConfig,
  ): ProviderConfig {
    const provider = this.config.getProvider(model.provider);
    if (!provider || provider.type !== this.openRouter.type) {
      throw OpenAiHttpError.internal();
    }

    return provider;
  }
}
