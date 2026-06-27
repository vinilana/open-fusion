import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { GatewayConfigService } from "./config/gateway-config.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(GatewayConfigService);
  await app.listen(config.getHttpPort());
}

void bootstrap();
