import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module";
import { LLM_GENERATION_PORT } from "../orchestration/llm-generation.port";
import { OpenRouterAdapter } from "./openrouter.adapter";
import { ProviderBackedLlmGenerationPort } from "./provider-backed-llm-generation.port";
import { ProviderRegistry } from "./provider-registry";

@Module({
  imports: [ConfigModule],
  providers: [
    OpenRouterAdapter,
    ProviderRegistry,
    {
      provide: LLM_GENERATION_PORT,
      useClass: ProviderBackedLlmGenerationPort,
    },
  ],
  exports: [LLM_GENERATION_PORT],
})
export class ProvidersModule {}
