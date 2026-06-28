import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GatewayConfigError,
  GatewayConfigService,
} from "../src/config/gateway-config.service";
import {
  minimalConfig,
  validEnv,
  writeConfig,
} from "./support/gateway-config.fixture";

describe("GatewayConfigService", () => {
  it("loads a valid single JSON config and resolves env secrets", () => {
    const { path, cleanup } = writeConfig(minimalConfig());
    try {
      const config = new GatewayConfigService({
        configPath: path,
        env: validEnv(),
      });

      expect(config.getHttpPort()).toBe(3001);
      expect(config.findClientByApiKey("test-gateway-key")).toEqual({
        id: "local-dev",
        apiKey: "test-gateway-key",
        allowedModels: ["route/default"],
      });
      expect(config.resolveRouteByPublicModel("route/default")).toMatchObject({
        id: "default",
        orchestrator: "orchestrator.default",
        allowedDelegateModels: ["worker.fast"],
        allowClientTools: false,
      });
      expect(JSON.stringify(config.listPublicModels())).not.toContain(
        "sk-openrouter",
      );
    } finally {
      cleanup();
    }
  });

  it("allows routes to opt in to client tools explicitly", () => {
    const rawConfig = minimalConfig();
    rawConfig.routes.default.allowClientTools = true;

    const config = new GatewayConfigService({
      rawConfig,
      env: validEnv(),
    });

    expect(config.resolveRouteByPublicModel("route/default")).toMatchObject({
      allowClientTools: true,
    });
  });

  it("loads configured payload and message limits for routes", () => {
    const rawConfig = minimalConfig();
    rawConfig.routes.default.maxMessages = 10;
    rawConfig.routes.default.maxMessageContentLength = 4096;
    rawConfig.routes.default.maxPayloadBytes = 65536;

    const config = new GatewayConfigService({
      rawConfig,
      env: validEnv(),
    });

    expect(config.resolveRouteByPublicModel("route/default")).toMatchObject({
      maxMessages: 10,
      maxMessageContentLength: 4096,
      maxPayloadBytes: 65536,
    });
  });

  it.each([["maxMessages"], ["maxMessageContentLength"], ["maxPayloadBytes"]])(
    "rejects invalid route limit %s",
    (field) => {
      const config = minimalConfig();
      (config.routes.default as Record<string, unknown>)[field] = 0;

      expectConfigErrorAt(
        () =>
          new GatewayConfigService({
            rawConfig: config,
            env: validEnv(),
          }),
        `routes.default.${field}`,
      );
    },
  );

  it("resolves required secrets from a dotenv file", () => {
    const { path, cleanup } = writeConfig(minimalConfig());
    const directory = mkdtempSync(join(tmpdir(), "open-fusion-env-"));
    const envFilePath = join(directory, ".env");
    writeFileSync(
      envFilePath,
      [
        "OPENROUTER_API_KEY=sk-openrouter-from-env-file",
        "OPEN_FUSION_DEV_API_KEY=dev-token-from-env-file",
        "OPEN_FUSION_RESTRICTED_API_KEY=restricted-token-from-env-file",
      ].join("\n"),
      "utf8",
    );

    try {
      const config = new GatewayConfigService({
        configPath: path,
        env: {},
        envFilePath,
      });

      expect(config.getProvider("openrouter")).toMatchObject({
        apiKey: "sk-openrouter-from-env-file",
      });
      expect(config.findClientByApiKey("dev-token-from-env-file")).toEqual({
        id: "local-dev",
        apiKey: "dev-token-from-env-file",
        allowedModels: ["route/default"],
      });
    } finally {
      cleanup();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails with a field path when a required env secret is missing", () => {
    const { path, cleanup } = writeConfig(minimalConfig());
    try {
      expectConfigErrorAt(
        () =>
          new GatewayConfigService({
            configPath: path,
            env: {
              OPEN_FUSION_DEV_API_KEY: "test-gateway-key",
              OPEN_FUSION_RESTRICTED_API_KEY: "restricted-gateway-key",
            },
          }),
        "providers.openrouter.apiKeyEnv",
      );
    } finally {
      cleanup();
    }
  });

  it("rejects unknown provider types", () => {
    const config = minimalConfig();
    config.providers.openrouter.type = "unknown";
    const { path, cleanup } = writeConfig(config);
    try {
      expectConfigErrorAt(
        () =>
          new GatewayConfigService({
            configPath: path,
            env: validEnv(),
          }),
        "providers.openrouter.type",
      );
    } finally {
      cleanup();
    }
  });

  it("rejects routes that reference a non-orchestrator model", () => {
    const config = minimalConfig();
    config.routes.default.orchestrator = "worker.fast";
    const { path, cleanup } = writeConfig(config);
    try {
      expectConfigErrorAt(
        () =>
          new GatewayConfigService({
            configPath: path,
            env: validEnv(),
          }),
        "routes.default.orchestrator",
      );
    } finally {
      cleanup();
    }
  });

  it("rejects allowed delegate models that are not delegate models", () => {
    const config = minimalConfig();
    config.routes.default.allowedDelegateModels = ["orchestrator.default"];
    const { path, cleanup } = writeConfig(config);
    try {
      expectConfigErrorAt(
        () =>
          new GatewayConfigService({
            configPath: path,
            env: validEnv(),
          }),
        "routes.default.allowedDelegateModels[0]",
      );
    } finally {
      cleanup();
    }
  });

  it("rejects allowed delegate models that do not exist", () => {
    const config = minimalConfig();
    config.routes.default.allowedDelegateModels = ["worker.missing"];

    expectConfigErrorAt(
      () =>
        new GatewayConfigService({
          rawConfig: config,
          env: validEnv(),
        }),
      "routes.default.allowedDelegateModels[0]",
    );
  });

  it("rejects delegate capabilities that are not strings", () => {
    const config = minimalConfig();
    config.models["worker.fast"].capabilities = [
      "math",
      42,
    ] as unknown as string[];

    expectConfigErrorAt(
      () =>
        new GatewayConfigService({
          rawConfig: config,
          env: validEnv(),
        }),
      "models.worker.fast.capabilities[1]",
    );
  });

  it("allows routed streaming routes without an allowed general delegate", () => {
    const config = minimalConfig();
    config.models["worker.fast"].capabilities = ["code"];
    config.models["orchestrator.default"].capabilities = ["general"];

    const service = new GatewayConfigService({
      rawConfig: config,
      env: validEnv(),
    });

    expect(service.resolveRouteByPublicModel("route/default")).toMatchObject({
      allowedDelegateModels: ["worker.fast"],
      streamFinalOnly: true,
    });
  });

  it("allows routed streaming delegates with non-canonical capabilities", () => {
    const config = minimalConfig();
    config.models["worker.fast"].capabilities = ["math"];
    config.models["worker.restricted"].capabilities = ["symbolic_math"];
    config.routes.default.allowedDelegateModels = [
      "worker.fast",
      "worker.restricted",
    ];

    const service = new GatewayConfigService({
      rawConfig: config,
      env: validEnv(),
    });

    expect(
      service.listAllowedDelegateModels(
        service.resolveRouteByPublicModel("route/default")!,
      ),
    ).toEqual([
      { id: "worker.fast", capabilities: ["math"] },
      { id: "worker.restricted", capabilities: ["symbolic_math"] },
    ]);
  });

  it("does not expose mutable allowed delegate capabilities", () => {
    const service = new GatewayConfigService({
      rawConfig: minimalConfig(),
      env: validEnv(),
    });
    const route = service.resolveRouteByPublicModel("route/default")!;
    const [delegate] = service.listAllowedDelegateModels(route);

    delegate.capabilities.push("mutated");

    expect(service.listAllowedDelegateModels(route)).toEqual([
      { id: "worker.fast", capabilities: ["general", "fast_draft"] },
    ]);
  });

  it("rejects non-boolean client tool route policy", () => {
    const config = minimalConfig();
    config.routes.default.allowClientTools = "yes" as unknown as boolean;
    const { path, cleanup } = writeConfig(config);
    try {
      expectConfigErrorAt(
        () =>
          new GatewayConfigService({
            configPath: path,
            env: validEnv(),
          }),
        "routes.default.allowClientTools",
      );
    } finally {
      cleanup();
    }
  });
});

function expectConfigErrorAt(received: () => unknown, path: string): void {
  expect(received).toThrow(GatewayConfigError);

  try {
    received();
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayConfigError);
    expect((error as GatewayConfigError).path).toBe(path);
    return;
  }

  throw new Error(`Expected GatewayConfigError at ${path}.`);
}
