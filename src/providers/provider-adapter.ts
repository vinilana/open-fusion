import {
  InternalModelConfig,
  ProviderConfig,
} from "../config/gateway-config.service";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmRoutingDecisionRequest,
  LlmStreamChunk,
  RoutingDecision,
} from "../orchestration/llm-generation.port";

export interface ProviderAdapter {
  readonly type: ProviderConfig["type"];

  generate(
    provider: ProviderConfig,
    model: InternalModelConfig,
    request: LlmGenerateRequest,
  ): Promise<LlmGenerateResult>;

  generateRoutingDecision(
    provider: ProviderConfig,
    model: InternalModelConfig,
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision>;

  stream?(
    provider: ProviderConfig,
    model: InternalModelConfig,
    request: LlmGenerateRequest,
  ): AsyncIterable<LlmStreamChunk>;
}
