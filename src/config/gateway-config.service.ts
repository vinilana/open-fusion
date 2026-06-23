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

export interface InternalModelConfig {
  id: string;
  provider: string;
  providerModel: string;
  role: "orchestrator" | "delegate";
  capabilities: string[];
  defaults: Record<string, unknown>;
}

export interface RouteConfig {
  id: string;
  publicModel: string;
  orchestrator: string;
  allowedDelegateModels: string[];
  maxDelegations: number;
  maxDepth: number;
  timeoutMs: number;
  delegateTimeoutMs: number;
  streamFinalOnly: boolean;
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

  private readonly internalModels: InternalModelConfig[] = [
    {
      id: "orchestrator.default",
      provider: "openrouter",
      providerModel: "openai/gpt-4.1",
      role: "orchestrator",
      capabilities: ["general"],
      defaults: {
        temperature: 0.2,
      },
    },
    {
      id: "worker.fast",
      provider: "openrouter",
      providerModel: "openai/gpt-4.1-mini",
      role: "delegate",
      capabilities: ["general", "fast_draft"],
      defaults: {
        temperature: 0.3,
      },
    },
    {
      id: "worker.restricted",
      provider: "openrouter",
      providerModel: "openai/gpt-4.1",
      role: "delegate",
      capabilities: ["reasoning"],
      defaults: {
        temperature: 0.1,
      },
    },
  ];

  private readonly routes: RouteConfig[] = [
    {
      id: "default",
      publicModel: "route/default",
      orchestrator: "orchestrator.default",
      allowedDelegateModels: ["worker.fast"],
      maxDelegations: 3,
      maxDepth: 1,
      timeoutMs: 60000,
      delegateTimeoutMs: 30000,
      streamFinalOnly: true,
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

  resolveRouteByPublicModel(publicModel: string): RouteConfig | undefined {
    return this.routes.find((route) => route.publicModel === publicModel);
  }

  findInternalModel(modelId: string): InternalModelConfig | undefined {
    return this.internalModels.find((model) => model.id === modelId);
  }

  listAllowedDelegateModels(
    route: RouteConfig,
  ): Array<{ id: string; capabilities: string[] }> {
    return route.allowedDelegateModels.flatMap((modelId) => {
      const model = this.findInternalModel(modelId);
      if (!model || model.role !== "delegate") {
        return [];
      }

      return [
        {
          id: model.id,
          capabilities: model.capabilities,
        },
      ];
    });
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
