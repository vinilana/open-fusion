import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module";
import { OperationalLoggerService } from "../ops/operational-logger.service";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { ProvidersModule } from "../providers/providers.module";
import { ChatCompletionsController } from "./chat-completions.controller";
import { ChatCompletionsService } from "./chat-completions.service";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";

@Module({
  imports: [ConfigModule, ProvidersModule],
  controllers: [ChatCompletionsController, ModelsController],
  providers: [
    ChatCompletionsService,
    ModelsService,
    OperationalLoggerService,
    OrchestrationService,
  ],
})
export class V1Module {}
