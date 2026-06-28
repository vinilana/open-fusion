import {
  InternalModelConfig,
  ProviderConfig,
} from "../config/gateway-config.service";
import {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmStreamChunk,
} from "../orchestration/llm-generation.port";

export interface ProviderAdapter {
  readonly type: ProviderConfig["type"];

  generate(
    provider: ProviderConfig,
    model: InternalModelConfig,
    request: LlmGenerateRequest,
  ): Promise<LlmGenerateResult>;

  stream?(
    provider: ProviderConfig,
    model: InternalModelConfig,
    request: LlmGenerateRequest,
  ): AsyncIterable<LlmStreamChunk>;
}
