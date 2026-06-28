import { ChatCompletionMessage } from "../v1/openai-types";

export const LLM_GENERATION_PORT = "LLM_GENERATION_PORT";

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
