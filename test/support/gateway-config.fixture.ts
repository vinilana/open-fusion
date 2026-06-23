import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RawGatewayConfig } from "../../src/config/gateway-config.service";

export function validEnv(): Record<string, string> {
  return {
    OPEN_FUSION_DEV_API_KEY: "test-gateway-key",
    OPEN_FUSION_RESTRICTED_API_KEY: "restricted-gateway-key",
    OPENROUTER_API_KEY: "sk-openrouter",
  };
}

export function writeConfig(config: RawGatewayConfig = minimalConfig()): {
  path: string;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "open-fusion-config-"));
  const path = join(directory, "open-fusion.config.json");
  writeFileSync(path, JSON.stringify(config), "utf8");

  return {
    path,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export function minimalConfig(): RawGatewayConfig {
  return {
    version: 1,
    server: {
      port: 3001,
      publicBaseUrl: "http://localhost:3001",
    },
    auth: {
      apiKeys: [
        {
          id: "local-dev",
          tokenEnv: "OPEN_FUSION_DEV_API_KEY",
          allowedRoutes: ["default"],
        },
        {
          id: "restricted-client",
          tokenEnv: "OPEN_FUSION_RESTRICTED_API_KEY",
          allowedRoutes: [],
        },
      ],
    },
    providers: {
      openrouter: {
        type: "openrouter",
        apiKeyEnv: "OPENROUTER_API_KEY",
        baseUrl: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": "https://example.com",
          "X-Title": "Open Fusion",
        },
      },
    },
    models: {
      "orchestrator.default": {
        provider: "openrouter",
        model: "openai/gpt-4.1",
        role: "orchestrator",
        capabilities: ["general"],
        defaults: {
          temperature: 0.2,
        },
      },
      "worker.fast": {
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        role: "delegate",
        capabilities: ["general", "fast_draft"],
        defaults: {
          temperature: 0.3,
        },
      },
      "worker.restricted": {
        provider: "openrouter",
        model: "openai/gpt-4.1",
        role: "delegate",
        capabilities: ["reasoning"],
        defaults: {
          temperature: 0.1,
        },
      },
    },
    routes: {
      default: {
        publicModel: "route/default",
        orchestrator: "orchestrator.default",
        allowedDelegateModels: ["worker.fast"],
        maxDelegations: 3,
        maxDepth: 1,
        timeoutMs: 60000,
        delegateTimeoutMs: 30000,
        streamFinalOnly: true,
      },
    },
    observability: {
      logLevel: "info",
      redact: ["apiKey", "token", "authorization"],
    },
  };
}
