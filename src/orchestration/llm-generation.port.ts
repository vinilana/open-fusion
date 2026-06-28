import { ChatCompletionMessage } from "../v1/openai-types";

export const LLM_GENERATION_PORT = "LLM_GENERATION_PORT";
export const ROUTING_DECISION_VALIDATION_PUBLIC_MESSAGE =
  "Routing decision failed validation.";

export type LlmInvocationRole = "orchestrator" | "delegate";
export type LlmFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter";

export interface DelegateModelContext {
  id: string;
  capabilities: string[];
}

export type RoutingDecisionFinalTarget =
  | {
      type: "delegate";
      target_model: string;
      matched_capability: string;
      reason?: string;
    }
  | {
      type: "orchestrator_fallback";
      reason?: string;
    };

export interface RoutingDecisionPreFinalTask {
  task_id: string;
  target_model: string;
  matched_capability: string;
  task: string;
  depends_on: string[];
}

export interface RoutingDecision {
  final_target: RoutingDecisionFinalTarget;
  pre_final_tasks?: RoutingDecisionPreFinalTask[];
}

export interface LlmRoutingDecisionRequest {
  requestId?: string;
  routeId?: string;
  modelId: string;
  publicModelId: string;
  role: "orchestrator";
  messages: ChatCompletionMessage[];
  system?: string;
  delegateModels: DelegateModelContext[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export const ROUTING_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["final_target"],
  properties: {
    final_target: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "target_model", "matched_capability"],
          properties: {
            type: {
              const: "delegate",
            },
            target_model: {
              type: "string",
              minLength: 1,
            },
            matched_capability: {
              type: "string",
              minLength: 1,
            },
            reason: {
              type: "string",
              minLength: 1,
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: {
              const: "orchestrator_fallback",
            },
            reason: {
              type: "string",
              minLength: 1,
            },
          },
        },
      ],
    },
    pre_final_tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "task_id",
          "target_model",
          "matched_capability",
          "task",
          "depends_on",
        ],
        properties: {
          task_id: {
            type: "string",
            minLength: 1,
          },
          target_model: {
            type: "string",
            minLength: 1,
          },
          matched_capability: {
            type: "string",
            minLength: 1,
          },
          task: {
            type: "string",
            minLength: 1,
          },
          depends_on: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
    },
  },
};

export function normalizeRoutingDecision(
  value: unknown,
): RoutingDecision | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["final_target", "pre_final_tasks"])
  ) {
    return undefined;
  }

  const finalTarget = normalizeRoutingDecisionFinalTarget(value.final_target);
  if (!finalTarget) {
    return undefined;
  }

  const decision: RoutingDecision = {
    final_target: finalTarget,
  };
  if ("pre_final_tasks" in value) {
    const tasks = normalizeRoutingDecisionPreFinalTasks(value.pre_final_tasks);
    if (!tasks) {
      return undefined;
    }
    decision.pre_final_tasks = tasks;
  }

  return decision;
}

function normalizeRoutingDecisionFinalTarget(
  value: unknown,
): RoutingDecisionFinalTarget | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  if (value.type === "delegate") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "target_model",
        "matched_capability",
        "reason",
      ]) ||
      !isNonEmptyString(value.target_model) ||
      !isNonEmptyString(value.matched_capability) ||
      !isOptionalNonEmptyString(value.reason)
    ) {
      return undefined;
    }

    const target: RoutingDecisionFinalTarget = {
      type: "delegate",
      target_model: value.target_model,
      matched_capability: value.matched_capability,
    };
    if (typeof value.reason === "string") {
      target.reason = value.reason;
    }

    return target;
  }

  if (value.type === "orchestrator_fallback") {
    if (
      !hasOnlyKeys(value, ["type", "reason"]) ||
      !isOptionalNonEmptyString(value.reason)
    ) {
      return undefined;
    }

    const target: RoutingDecisionFinalTarget = {
      type: "orchestrator_fallback",
    };
    if (typeof value.reason === "string") {
      target.reason = value.reason;
    }

    return target;
  }

  return undefined;
}

function normalizeRoutingDecisionPreFinalTasks(
  value: unknown,
): RoutingDecisionPreFinalTask[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tasks: RoutingDecisionPreFinalTask[] = [];
  for (const item of value) {
    const task = normalizeRoutingDecisionPreFinalTask(item);
    if (!task) {
      return undefined;
    }
    tasks.push(task);
  }

  return tasks;
}

function normalizeRoutingDecisionPreFinalTask(
  value: unknown,
): RoutingDecisionPreFinalTask | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "task_id",
      "target_model",
      "matched_capability",
      "task",
      "depends_on",
    ]) ||
    !isNonEmptyString(value.task_id) ||
    !isNonEmptyString(value.target_model) ||
    !isNonEmptyString(value.matched_capability) ||
    !isNonEmptyString(value.task) ||
    !isNonEmptyStringArray(value.depends_on)
  ) {
    return undefined;
  }

  return {
    task_id: value.task_id,
    target_model: value.target_model,
    matched_capability: value.matched_capability,
    task: value.task,
    depends_on: value.depends_on,
  };
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface DelegateLlmToolCall {
  id: string;
  name: "delegate_llm";
  arguments: {
    target_model: string;
    task: string;
    messages?: ChatCompletionMessage[];
    output_contract?: string;
    reason?: string;
    task_id?: string;
    depends_on?: string[];
    final?: boolean;
  };
}

export interface DelegateToolResult {
  toolCallId: string;
  targetModel: string;
  task: string;
  status: "success" | "error";
  content: string;
  finishReason?: LlmFinishReason;
  usage?: LlmUsage;
  latencyMs: number;
  untrusted: true;
}

export interface LlmGenerateRequest {
  requestId?: string;
  routeId?: string;
  modelId: string;
  publicModelId: string;
  role: LlmInvocationRole;
  messages: ChatCompletionMessage[];
  system?: string;
  delegateModels?: DelegateModelContext[];
  internalTools?: ["delegate_llm"];
  clientTools?: unknown[];
  toolResults?: DelegateToolResult[];
  streamFinalOnly?: boolean;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmGenerateResult {
  content: string;
  finishReason: LlmFinishReason;
  toolCalls?: DelegateLlmToolCall[];
  usage?: LlmUsage;
}

export interface LlmStreamChunk {
  content: string;
  finishReason: LlmFinishReason | null;
  usage?: LlmUsage;
}

export interface LlmGenerationPort {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResult>;
  generateRoutingDecision?(
    request: LlmRoutingDecisionRequest,
  ): Promise<RoutingDecision>;
  stream?(request: LlmGenerateRequest): AsyncIterable<LlmStreamChunk>;
}
