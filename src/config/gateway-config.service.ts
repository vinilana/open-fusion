import { Injectable } from "@nestjs/common";

export interface GatewayClient {
  id: string;
  apiKey: string;
  allowedModels: string[];
}

export interface PublicModelConfig {
  id: string;
  created: number;
  ownedBy: string;
}

export interface ModelAccessPolicy {
  allowedModels: string[];
}

@Injectable()
export class GatewayConfigService {
  private readonly clients: GatewayClient[] = [
    {
      id: "test-client",
      apiKey: "test-gateway-key",
      allowedModels: ["route/default"],
    },
    {
      id: "restricted-client",
      apiKey: "restricted-gateway-key",
      allowedModels: [],
    },
  ];

  private readonly publicModels: PublicModelConfig[] = [
    {
      id: "route/default",
      created: 1710000000,
      ownedBy: "open-fusion",
    },
  ];

  findClientByApiKey(apiKey: string): GatewayClient | undefined {
    return this.clients.find((client) => client.apiKey === apiKey);
  }

  listModelsForClient(client: ModelAccessPolicy): PublicModelConfig[] {
    return this.publicModels.filter((model) =>
      client.allowedModels.includes(model.id),
    );
  }

  findPublicModel(modelId: string): PublicModelConfig | undefined {
    return this.publicModels.find((model) => model.id === modelId);
  }

  getHttpPort(): number {
    const rawPort = process.env.PORT;
    if (!rawPort) {
      return 3000;
    }

    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return 3000;
    }

    return port;
  }
}
