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
      });
      expect(JSON.stringify(config.listPublicModels())).not.toContain(
        "sk-openrouter",
      );
    } finally {
      cleanup();
    }
  });

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
