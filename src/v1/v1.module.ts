import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module";
import { LLM_GENERATION_PORT } from "../orchestration/llm-generation.port";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { StubLlmGenerationPort } from "../orchestration/stub-llm-generation.port";
import { ChatCompletionsController } from "./chat-completions.controller";
import { ChatCompletionsService } from "./chat-completions.service";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";

@Module({
  imports: [ConfigModule],
  controllers: [ChatCompletionsController, ModelsController],
  providers: [
    ChatCompletionsService,
    ModelsService,
    OrchestrationService,
    {
      provide: LLM_GENERATION_PORT,
      useClass: StubLlmGenerationPort,
    },
  ],
})
export class V1Module {}
