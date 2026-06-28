import { INestApplication } from "@nestjs/common";
import { json } from "express";

import { GatewayConfigService } from "./config/gateway-config.service";
import { RequestIdMiddleware } from "./request-id/request-id.middleware";

export function configureHttpApp(app: INestApplication): void {
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));

  const config = app.get(GatewayConfigService);
  app.use(
    json({
      limit: config.getMaxPayloadBytes(),
    }),
  );
}
