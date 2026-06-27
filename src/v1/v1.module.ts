import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module";
import { ChatCompletionsController } from "./chat-completions.controller";
import { ChatCompletionsService } from "./chat-completions.service";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";

@Module({
  imports: [ConfigModule],
  controllers: [ChatCompletionsController, ModelsController],
  providers: [ChatCompletionsService, ModelsService],
})
export class V1Module {}
