import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard";
import { ConfigModule } from "./config/config.module";
import { OpenAiErrorFilter } from "./errors/openai-error.filter";
import { V1Module } from "./v1/v1.module";

@Module({
  imports: [ConfigModule, V1Module],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: OpenAiErrorFilter,
    },
  ],
})
export class AppModule {}
