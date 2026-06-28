import { Controller, Get } from "@nestjs/common";

import { GatewayConfigService } from "../config/gateway-config.service";

@Controller("health")
export class HealthController {
  constructor(private readonly config: GatewayConfigService) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  ready(): { status: "ok"; checks: { config: "loaded" } } {
    this.config.listPublicModels();

    return {
      status: "ok",
      checks: {
        config: "loaded",
      },
    };
  }
}
