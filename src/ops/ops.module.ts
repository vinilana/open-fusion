import { Module } from "@nestjs/common";

import { OperationalLoggerService } from "./operational-logger.service";

@Module({
  providers: [OperationalLoggerService],
  exports: [OperationalLoggerService],
})
export class OpsModule {}
