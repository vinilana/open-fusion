import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";

import { GatewayConfigService } from "../config/gateway-config.service";
import { OpenAiHttpError } from "../errors/openai-http-error";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: GatewayConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.path.startsWith("/v1/")) {
      return true;
    }

    const apiKey = this.extractBearerToken(request.header("authorization"));
    if (!apiKey) {
      throw OpenAiHttpError.authentication();
    }

    const client = this.config.findClientByApiKey(apiKey);
    if (!client) {
      throw OpenAiHttpError.authentication();
    }

    request.authenticatedClient = {
      id: client.id,
      allowedModels: [...client.allowedModels],
    };

    return true;
  }

  private extractBearerToken(header: string | undefined): string | undefined {
    const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
    return match?.[1]?.trim();
  }
}
