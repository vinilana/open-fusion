import { existsSync, readFileSync } from "node:fs";

import { Inject, Injectable, Optional } from "@nestjs/common";

import { hasCanonicalRoutingCapability } from "../routing/routing-capabilities";

export interface RawGatewayConfig {
  version: number;
  server: {
    port: number;
    publicBaseUrl?: string;
  };
  auth: {
    apiKeys: Array<{
      id: string;
      tokenEnv: string;
      allowedRoutes: string[];
    }>;
  };
  providers: Record<
    string,
    {
      type: string;
      apiKeyEnv: string;
      baseUrl?: string;
      headers?: Record<string, string>;
      providerOptions?: Record<string, unknown>;
    }
  >;
  models: Record<
    string,
    {
      provider: string;
      model: string;
      role: "orchestrator" | "delegate";
      capabilities?: string[];
      defaults?: Record<string, unknown>;
    }
  >;
  routes: Record<
    string,
    {
      publicModel: string;
      orchestrator: string;
      allowedDelegateModels: string[];
      maxDelegations: number;
      maxDepth: number;
      timeoutMs: number;
      delegateTimeoutMs: number;
      streamFinalOnly: boolean;
      allowClientTools?: boolean;
      maxMessages?: number;
      maxMessageContentLength?: number;
      maxPayloadBytes?: number;
    }
  >;
  observability?: {
    logLevel?: string;
    redact?: string[];
  };
}

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

export interface ProviderConfig {
  id: string;
  type: "openrouter";
  apiKey: string;
  apiKeyEnv: string;
  baseUrl: string;
  headers: Record<string, string>;
  providerOptions: Record<string, unknown>;
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
  allowClientTools: boolean;
  maxMessages: number;
  maxMessageContentLength: number;
  maxPayloadBytes: number;
}

export interface ModelAccessPolicy {
  allowedModels: string[];
}

export interface GatewayConfigServiceOptions {
  configPath?: string;
  env?: Record<string, string | undefined>;
  envFilePath?: string;
  rawConfig?: RawGatewayConfig;
}

export const GATEWAY_CONFIG_OPTIONS = "GATEWAY_CONFIG_OPTIONS";

const DEFAULT_MAX_MESSAGES = 128;
const DEFAULT_MAX_MESSAGE_CONTENT_LENGTH = 32768;
const DEFAULT_MAX_PAYLOAD_BYTES = 1048576;

interface RuntimeGatewayConfig {
  server: {
    port: number;
  };
  clients: GatewayClient[];
  providers: ProviderConfig[];
  internalModels: InternalModelConfig[];
  routes: RouteConfig[];
  publicModels: PublicModelConfig[];
}

export class GatewayConfigError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`Invalid Open Fusion config at ${path}: ${message}`);
  }
}

@Injectable()
export class GatewayConfigService {
  private readonly runtime: RuntimeGatewayConfig;

  constructor(
    @Optional()
    @Inject(GATEWAY_CONFIG_OPTIONS)
    options: GatewayConfigServiceOptions = {},
  ) {
    const env = resolveConfigEnvironment(options);
    const rawConfig =
      options.rawConfig ??
      loadRawConfig(
        options.configPath ??
          env.OPEN_FUSION_CONFIG ??
          "./config/open-fusion.config.json",
      );

    this.runtime = validateConfig(rawConfig, env);
  }

  findClientByApiKey(apiKey: string): GatewayClient | undefined {
    return this.runtime.clients.find((client) => client.apiKey === apiKey);
  }

  listModelsForClient(client: ModelAccessPolicy): PublicModelConfig[] {
    return this.runtime.publicModels.filter((model) =>
      client.allowedModels.includes(model.id),
    );
  }

  listPublicModels(): PublicModelConfig[] {
    return [...this.runtime.publicModels];
  }

  findPublicModel(modelId: string): PublicModelConfig | undefined {
    return this.runtime.publicModels.find((model) => model.id === modelId);
  }

  resolveRouteByPublicModel(publicModel: string): RouteConfig | undefined {
    return this.runtime.routes.find(
      (route) => route.publicModel === publicModel,
    );
  }

  findInternalModel(modelId: string): InternalModelConfig | undefined {
    return this.runtime.internalModels.find((model) => model.id === modelId);
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.runtime.providers.find(
      (provider) => provider.id === providerId,
    );
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
    return this.runtime.server.port;
  }
}

function resolveConfigEnvironment(
  options: GatewayConfigServiceOptions,
): Record<string, string | undefined> {
  const baseEnv = options.env ?? process.env;
  const envFilePath =
    options.envFilePath ?? (options.env === undefined ? ".env" : undefined);

  if (!envFilePath) {
    return baseEnv;
  }

  return mergeEnv(loadDotEnvFile(envFilePath), baseEnv);
}

function loadDotEnvFile(envFilePath: string): Record<string, string> {
  if (!existsSync(envFilePath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(envFilePath, "utf8")
      .split(/\r?\n/u)
      .flatMap((line) => parseDotEnvLine(line)),
  );
}

function parseDotEnvLine(line: string): Array<[string, string]> {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return [];
  }

  const normalized = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trimStart()
    : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) {
    return [];
  }

  const key = normalized.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    return [];
  }

  return [[key, parseDotEnvValue(normalized.slice(separator + 1).trim())]];
}

function parseDotEnvValue(rawValue: string): string {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue
      .slice(1, -1)
      .replace(/\\n/gu, "\n")
      .replace(/\\r/gu, "\r")
      .replace(/\\t/gu, "\t")
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, "\\");
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  return rawValue.replace(/\s+#.*$/u, "").trim();
}

function mergeEnv(
  fileEnv: Record<string, string>,
  baseEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...fileEnv };

  Object.entries(baseEnv).forEach(([key, value]) => {
    if (value !== undefined) {
      merged[key] = value;
    }
  });

  return merged;
}

function loadRawConfig(configPath: string): RawGatewayConfig {
  if (!existsSync(configPath)) {
    throw new GatewayConfigError(
      "OPEN_FUSION_CONFIG",
      `config file '${configPath}' was not found`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new GatewayConfigError(
      "OPEN_FUSION_CONFIG",
      `config file '${configPath}' is not valid JSON: ${getErrorMessage(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new GatewayConfigError("$", "config must be a JSON object");
  }

  return parsed as unknown as RawGatewayConfig;
}

function validateConfig(
  raw: RawGatewayConfig,
  env: Record<string, string | undefined>,
): RuntimeGatewayConfig {
  validateVersion(raw.version);
  validatePort(raw.server?.port);

  const providers = validateProviders(raw.providers, env);
  const providerIds = new Set(providers.map((provider) => provider.id));
  const internalModels = validateModels(raw.models, providerIds);
  const modelMap = new Map(internalModels.map((model) => [model.id, model]));
  const routes = validateRoutes(raw.routes, modelMap);
  const routeMap = new Map(routes.map((route) => [route.id, route]));
  const clients = validateClients(raw.auth?.apiKeys, env, routeMap);

  return {
    server: {
      port: raw.server.port,
    },
    clients,
    providers,
    internalModels,
    routes,
    publicModels: routes.map((route) => ({
      id: route.publicModel,
      created: 1710000000,
      ownedBy: "open-fusion",
    })),
  };
}

function validateVersion(version: unknown): void {
  if (version !== 1) {
    throw new GatewayConfigError("version", "supported version is 1");
  }
}

function validatePort(port: unknown): void {
  if (!Number.isInteger(port) || Number(port) <= 0 || Number(port) > 65535) {
    throw new GatewayConfigError(
      "server.port",
      "must be an integer between 1 and 65535",
    );
  }
}

function validateProviders(
  rawProviders: RawGatewayConfig["providers"],
  env: Record<string, string | undefined>,
): ProviderConfig[] {
  if (!isRecord(rawProviders)) {
    throw new GatewayConfigError("providers", "must be an object");
  }

  return Object.entries(rawProviders).map(([id, provider]) => {
    if (!isRecord(provider)) {
      throw new GatewayConfigError(`providers.${id}`, "must be an object");
    }
    if (provider.type !== "openrouter") {
      throw new GatewayConfigError(
        `providers.${id}.type`,
        "must be 'openrouter'",
      );
    }
    if (typeof provider.apiKeyEnv !== "string" || provider.apiKeyEnv === "") {
      throw new GatewayConfigError(
        `providers.${id}.apiKeyEnv`,
        "must be a non-empty env var name",
      );
    }

    const apiKey = env[provider.apiKeyEnv];
    if (!apiKey) {
      throw new GatewayConfigError(
        `providers.${id}.apiKeyEnv`,
        `env var '${provider.apiKeyEnv}' is not set`,
      );
    }

    return {
      id,
      type: "openrouter",
      apiKey,
      apiKeyEnv: provider.apiKeyEnv,
      baseUrl:
        typeof provider.baseUrl === "string" && provider.baseUrl !== ""
          ? provider.baseUrl
          : "https://openrouter.ai/api/v1",
      headers: validateStringRecord(
        provider.headers,
        `providers.${id}.headers`,
      ),
      providerOptions: isRecord(provider.providerOptions)
        ? provider.providerOptions
        : {},
    };
  });
}

function validateModels(
  rawModels: RawGatewayConfig["models"],
  providerIds: Set<string>,
): InternalModelConfig[] {
  if (!isRecord(rawModels)) {
    throw new GatewayConfigError("models", "must be an object");
  }

  return Object.entries(rawModels).map(([id, model]) => {
    if (!isRecord(model)) {
      throw new GatewayConfigError(`models.${id}`, "must be an object");
    }
    if (
      typeof model.provider !== "string" ||
      !providerIds.has(model.provider)
    ) {
      throw new GatewayConfigError(
        `models.${id}.provider`,
        "must reference an existing provider",
      );
    }
    if (typeof model.model !== "string" || model.model === "") {
      throw new GatewayConfigError(
        `models.${id}.model`,
        "must be a non-empty provider model id",
      );
    }
    if (model.role !== "orchestrator" && model.role !== "delegate") {
      throw new GatewayConfigError(
        `models.${id}.role`,
        "must be 'orchestrator' or 'delegate'",
      );
    }

    return {
      id,
      provider: model.provider,
      providerModel: model.model,
      role: model.role,
      capabilities: validateStringArray(
        model.capabilities ?? [],
        `models.${id}.capabilities`,
      ),
      defaults: isRecord(model.defaults) ? model.defaults : {},
    };
  });
}

function validateRoutes(
  rawRoutes: RawGatewayConfig["routes"],
  models: Map<string, InternalModelConfig>,
): RouteConfig[] {
  if (!isRecord(rawRoutes)) {
    throw new GatewayConfigError("routes", "must be an object");
  }

  return Object.entries(rawRoutes).map(([id, route]) => {
    if (!isRecord(route)) {
      throw new GatewayConfigError(`routes.${id}`, "must be an object");
    }
    if (typeof route.publicModel !== "string" || route.publicModel === "") {
      throw new GatewayConfigError(
        `routes.${id}.publicModel`,
        "must be a non-empty public model id",
      );
    }

    const orchestrator = models.get(String(route.orchestrator));
    if (!orchestrator || orchestrator.role !== "orchestrator") {
      throw new GatewayConfigError(
        `routes.${id}.orchestrator`,
        "must reference an orchestrator model",
      );
    }

    const allowedDelegateModels = validateStringArray(
      route.allowedDelegateModels,
      `routes.${id}.allowedDelegateModels`,
    );
    allowedDelegateModels.forEach((modelId, index) => {
      const delegate = models.get(modelId);
      if (!delegate || delegate.role !== "delegate") {
        throw new GatewayConfigError(
          `routes.${id}.allowedDelegateModels[${index}]`,
          "must reference a delegate model",
        );
      }
    });

    validatePositiveInteger(
      route.maxDelegations,
      `routes.${id}.maxDelegations`,
    );
    validatePositiveInteger(route.timeoutMs, `routes.${id}.timeoutMs`);
    validatePositiveInteger(
      route.delegateTimeoutMs,
      `routes.${id}.delegateTimeoutMs`,
    );
    const maxMessages = validateOptionalPositiveInteger(
      route.maxMessages,
      `routes.${id}.maxMessages`,
      DEFAULT_MAX_MESSAGES,
    );
    const maxMessageContentLength = validateOptionalPositiveInteger(
      route.maxMessageContentLength,
      `routes.${id}.maxMessageContentLength`,
      DEFAULT_MAX_MESSAGE_CONTENT_LENGTH,
    );
    const maxPayloadBytes = validateOptionalPositiveInteger(
      route.maxPayloadBytes,
      `routes.${id}.maxPayloadBytes`,
      DEFAULT_MAX_PAYLOAD_BYTES,
    );
    if (route.maxDepth !== 1) {
      throw new GatewayConfigError(
        `routes.${id}.maxDepth`,
        "must be 1 for the MVP",
      );
    }
    if (typeof route.streamFinalOnly !== "boolean") {
      throw new GatewayConfigError(
        `routes.${id}.streamFinalOnly`,
        "must be a boolean",
      );
    }
    if (route.streamFinalOnly) {
      let hasGeneralDelegate = false;
      allowedDelegateModels.forEach((modelId, index) => {
        const delegate = models.get(modelId);
        if (!delegate) {
          return;
        }
        if (!hasCanonicalRoutingCapability(delegate.capabilities)) {
          throw new GatewayConfigError(
            `routes.${id}.allowedDelegateModels[${index}]`,
            "routed streaming delegates must declare at least one canonical capability: plan, code, review, design, or general",
          );
        }
        if (delegate.capabilities.includes("general")) {
          hasGeneralDelegate = true;
        }
      });
      if (!hasGeneralDelegate) {
        throw new GatewayConfigError(
          `routes.${id}.allowedDelegateModels`,
          "routed streaming routes must include at least one allowed delegate with the 'general' capability",
        );
      }
    }
    if (
      route.allowClientTools !== undefined &&
      typeof route.allowClientTools !== "boolean"
    ) {
      throw new GatewayConfigError(
        `routes.${id}.allowClientTools`,
        "must be a boolean",
      );
    }

    return {
      id,
      publicModel: route.publicModel,
      orchestrator: route.orchestrator,
      allowedDelegateModels,
      maxDelegations: route.maxDelegations,
      maxDepth: route.maxDepth,
      timeoutMs: route.timeoutMs,
      delegateTimeoutMs: route.delegateTimeoutMs,
      streamFinalOnly: route.streamFinalOnly,
      allowClientTools: route.allowClientTools === true,
      maxMessages,
      maxMessageContentLength,
      maxPayloadBytes,
    };
  });
}

function validateClients(
  apiKeys: RawGatewayConfig["auth"]["apiKeys"],
  env: Record<string, string | undefined>,
  routes: Map<string, RouteConfig>,
): GatewayClient[] {
  if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
    throw new GatewayConfigError("auth.apiKeys", "must be a non-empty array");
  }

  return apiKeys.map((client, index) => {
    if (!isRecord(client)) {
      throw new GatewayConfigError(
        `auth.apiKeys[${index}]`,
        "must be an object",
      );
    }
    if (typeof client.id !== "string" || client.id === "") {
      throw new GatewayConfigError(
        `auth.apiKeys[${index}].id`,
        "must be a non-empty string",
      );
    }
    if (typeof client.tokenEnv !== "string" || client.tokenEnv === "") {
      throw new GatewayConfigError(
        `auth.apiKeys[${index}].tokenEnv`,
        "must be a non-empty env var name",
      );
    }

    const apiKey = env[client.tokenEnv];
    if (!apiKey) {
      throw new GatewayConfigError(
        `auth.apiKeys[${index}].tokenEnv`,
        `env var '${client.tokenEnv}' is not set`,
      );
    }

    const allowedRoutes = validateStringArray(
      client.allowedRoutes,
      `auth.apiKeys[${index}].allowedRoutes`,
    );
    const allowedModels = allowedRoutes.map((routeId, routeIndex) => {
      const route = routes.get(routeId);
      if (!route) {
        throw new GatewayConfigError(
          `auth.apiKeys[${index}].allowedRoutes[${routeIndex}]`,
          "must reference an existing route",
        );
      }

      return route.publicModel;
    });

    return {
      id: client.id,
      apiKey,
      allowedModels,
    };
  });
}

function validatePositiveInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new GatewayConfigError(path, "must be a positive integer");
  }
}

function validateOptionalPositiveInteger(
  value: unknown,
  path: string,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  validatePositiveInteger(value, path);
  return Number(value);
}

function validateStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new GatewayConfigError(path, "must be an array of strings");
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item === "") {
      throw new GatewayConfigError(
        `${path}[${index}]`,
        "must be a non-empty string",
      );
    }

    return item;
  });
}

function validateStringRecord(
  value: unknown,
  path: string,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new GatewayConfigError(path, "must be an object");
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== "string") {
        throw new GatewayConfigError(`${path}.${key}`, "must be a string");
      }

      return [key, item];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
