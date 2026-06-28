import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module";
import { OpsModule } from "../ops/ops.module";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { ProvidersModule } from "../providers/providers.module";
import { ChatCompletionsController } from "./chat-completions.controller";
import { ChatCompletionsService } from "./chat-completions.service";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";

@Module({
  imports: [ConfigModule, ProvidersModule, OpsModule],
  controllers: [ChatCompletionsController, ModelsController],
  providers: [ChatCompletionsService, ModelsService, OrchestrationService],
})
export class V1Module {}
