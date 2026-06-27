import { Module } from "@nestjs/common";

import { GatewayConfigService } from "./gateway-config.service";

@Module({
  providers: [GatewayConfigService],
  exports: [GatewayConfigService],
})
export class ConfigModule {}
