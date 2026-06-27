import { Injectable } from "@nestjs/common";

import { GatewayConfigService } from "../config/gateway-config.service";
import { ModelsResponse } from "./openai-types";

interface AuthenticatedClient {
  id: string;
  allowedModels: string[];
}

@Injectable()
export class ModelsService {
  constructor(private readonly config: GatewayConfigService) {}

  list(client: AuthenticatedClient): ModelsResponse {
    return {
      object: "list",
      data: this.config.listModelsForClient(client).map((model) => ({
        id: model.id,
        object: "model",
        created: model.created,
        owned_by: model.ownedBy,
      })),
    };
  }
}
