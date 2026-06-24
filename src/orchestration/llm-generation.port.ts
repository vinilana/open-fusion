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

export interface DelegateLlmToolCall {
  id: string;
  name: "delegate_llm";
  arguments: {
    target_model: string;
    task: string;
    messages?: ChatCompletionMessage[];
    output_contract?: string;
    reason?: string;
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

export interface LlmGenerationPort {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResult>;
  stream?(request: LlmGenerateRequest): AsyncIterable<string>;
}
